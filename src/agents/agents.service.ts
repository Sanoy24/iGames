import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { AgentShift } from './entities/agent-shift.entity';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UsersService } from '../users/users.service';
import { SystemConfig } from '../admin/entities/system-config.entity';
import { isAgentEffectivelyOnDuty } from '../common/agent-duty.util';
import { PayoutProvider, WithdrawalProofVerifierService } from './withdrawal-proof-verifier.service';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(AgentShift)
    private readonly agentShiftRepository: Repository<AgentShift>,
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
    private readonly walletService: WalletService,
    private readonly usersService: UsersService,
    private readonly withdrawalProofVerifier: WithdrawalProofVerifierService,
  ) {}

  // ── Config (agent-accessible) ────────────────────────────────────

  async getAgentConfig(): Promise<{ withdrawalServiceChargePct: number; withdrawalCommissionPct: number }> {
    const config = await this.systemConfigRepository.findOneBy({ key: 'global' });
    return {
      withdrawalServiceChargePct: config?.withdrawalServiceChargePct ?? 0,
      withdrawalCommissionPct: config?.withdrawalCommissionPct ?? 0,
    };
  }

  // ── Withdrawals ────────────────────────────────────────────────────

  getAvailableWithdrawals() {
    return this.walletService.getAvailableWithdrawals();
  }

  getMyWithdrawals(agentId: string) {
    return this.walletService.getAgentWithdrawals(agentId);
  }

  async getTransactionHistory(agentId: string) {
    const [ledger, withdrawals] = await Promise.all([
      this.walletService.getLedgerEntries({ userId: agentId, limit: 100 }),
      this.walletService.getAgentWithdrawalHistory(agentId),
    ]);

    return { ledger, withdrawals };
  }

  /**
   * Unified agent gate: an agent may only act while **effectively on duty** — i.e.
   * inside their working window (Ethiopia time) or manually pinned on — and only
   * for actions their permissions allow. All time math is Ethiopia-based, so it no
   * longer depends on the server clock.
   */
  verifyAgentWorkingHoursAndPermission(agent: any, permission: 'deposit' | 'withdraw') {
    // 1. Must be on duty (scheduled window or admin override).
    if (!isAgentEffectivelyOnDuty(agent)) {
      throw new BadRequestException('You are off duty right now (outside your working hours).');
    }

    // 2. Must have permission for this action.
    if (agent.agentPermissions && agent.agentPermissions[permission] === false) {
      throw new BadRequestException(`Agent does not have ${permission} permission`);
    }
  }

  async claimWithdrawal(withdrawalId: string, agentId: string) {
    const agent = await this.usersService.findById(agentId);
    this.verifyAgentWorkingHoursAndPermission(agent, 'withdraw');
    return this.walletService.claimWithdrawal(withdrawalId, agentId);
  }

  async releaseWithdrawal(withdrawalId: string, agentId: string) {
    const agent = await this.usersService.findById(agentId);
    this.verifyAgentWorkingHoursAndPermission(agent, 'withdraw');
    return this.walletService.releaseWithdrawal(withdrawalId, agentId);
  }

  async completeWithdrawal(
    withdrawalId: string,
    agentId: string,
    provider: PayoutProvider,
    proof: string,
  ) {
    const agent = await this.usersService.findById(agentId);
    this.verifyAgentWorkingHoursAndPermission(agent, 'withdraw');
    // Read fee/commission split and the designated super-admin from system config.
    const config = await this.systemConfigRepository.findOneBy({ key: 'global' });
    const serviceFeePct = config?.withdrawalServiceChargePct ?? 0;
    const commissionPct = config?.withdrawalCommissionPct ?? 0;
    const superAdminUserId = config?.superAdminUserId ?? null;
    const creditMinorPerBirr = config?.telebirrCreditMinorPerBirr ?? 1;

    // The withdrawal must be claimed by THIS agent, and we need its destination
    // (the player's phone) and amount to check the payout proof against.
    const withdrawal = await this.walletService.getClaimedWithdrawalForAgent(withdrawalId, agentId);

    // The player receives the net amount (gross − service fee − commission); that
    // is exactly what the agent must have paid out.
    const serviceFeeMinor = Math.floor((withdrawal.amountMinor * serviceFeePct) / 100);
    const commissionMinor = Math.floor((withdrawal.amountMinor * commissionPct) / 100);
    const expectedAmountMinor = withdrawal.amountMinor - serviceFeeMinor - commissionMinor;

    // Verify the agent actually paid the player before releasing frozen coins.
    const verified = await this.withdrawalProofVerifier.verifyPayout({
      provider,
      proof,
      destinationAccount: withdrawal.destinationAccount,
      expectedAmountMinor,
      creditMinorPerBirr,
    });

    return this.walletService.completeWithdrawalByAgent({
      withdrawalId,
      agentId,
      telebirrReference: verified.reference,
      paymentProvider: verified.provider,
      payoutVerification: verified.verification,
      serviceFeePct,
      commissionPct,
      superAdminUserId,
    });
  }

  // ── Shifts ─────────────────────────────────────────────────────────

  async createShift(dto: CreateShiftDto): Promise<any> {
    const shift = this.agentShiftRepository.create({
      agentId: dto.agentId,
      startHour: dto.startHour,
      startMinute: dto.startMinute,
      endHour: dto.endHour,
      endMinute: dto.endMinute,
      daysOfWeek: dto.daysOfWeek ?? [],
      label: dto.label,
      isActive: dto.isActive ?? true,
    });
    await this.agentShiftRepository.save(shift);

    const saved = await this.agentShiftRepository.findOne({
      where: { id: shift.id },
      relations: ['user']
    });
    return this.toShiftResponse(saved!);
  }

  async listShifts(): Promise<any[]> {
    const shifts = await this.agentShiftRepository.find({
      relations: ['user'],
      order: { startHour: 'ASC', startMinute: 'ASC' }
    });
    return shifts.map((s) => this.toShiftResponse(s));
  }

  async updateShift(shiftId: string, dto: Partial<CreateShiftDto>): Promise<any> {
    const shift = await this.agentShiftRepository.findOneBy({ id: shiftId });
    if (!shift) throw new NotFoundException('Shift not found');

    if (dto.agentId !== undefined) shift.agentId = dto.agentId;
    if (dto.startHour !== undefined) shift.startHour = dto.startHour;
    if (dto.startMinute !== undefined) shift.startMinute = dto.startMinute;
    if (dto.endHour !== undefined) shift.endHour = dto.endHour;
    if (dto.endMinute !== undefined) shift.endMinute = dto.endMinute;
    if (dto.daysOfWeek !== undefined) shift.daysOfWeek = dto.daysOfWeek;
    if (dto.label !== undefined) shift.label = dto.label;
    if (dto.isActive !== undefined) shift.isActive = dto.isActive;

    await this.agentShiftRepository.save(shift);

    const saved = await this.agentShiftRepository.findOne({
      where: { id: shift.id },
      relations: ['user']
    });
    return this.toShiftResponse(saved!);
  }

  async deleteShift(shiftId: string): Promise<void> {
    await this.agentShiftRepository.delete({ id: shiftId });
  }

  /**
   * Returns the agentId of the shift that covers the current moment,
   * or null if no active shift matches.
   * Overnight shifts (endTime < startTime) are handled correctly.
   */
  async getActiveShiftAgentId(): Promise<string | null> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const shifts = await this.agentShiftRepository.findBy({ isActive: true });

    for (const shift of shifts) {
      const dayMatch =
        shift.daysOfWeek.length === 0 || shift.daysOfWeek.includes(dayOfWeek);
      if (!dayMatch) continue;

      const startMinutes = shift.startHour * 60 + shift.startMinute;
      const endMinutes = shift.endHour * 60 + shift.endMinute;

      const isOvernightShift = endMinutes <= startMinutes;
      const inWindow = isOvernightShift
        ? currentMinutes >= startMinutes || currentMinutes < endMinutes
        : currentMinutes >= startMinutes && currentMinutes < endMinutes;

      if (inWindow) {
        return shift.agentId;
      }
    }

    return null;
  }

  async getActiveShift(): Promise<any | null> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const shifts = await this.agentShiftRepository.find({
      where: { isActive: true },
      relations: ['user']
    });

    for (const shift of shifts) {
      const dayMatch =
        shift.daysOfWeek.length === 0 || shift.daysOfWeek.includes(dayOfWeek);
      if (!dayMatch) continue;

      const startMinutes = shift.startHour * 60 + shift.startMinute;
      const endMinutes = shift.endHour * 60 + shift.endMinute;

      const isOvernightShift = endMinutes <= startMinutes;
      const inWindow = isOvernightShift
        ? currentMinutes >= startMinutes || currentMinutes < endMinutes
        : currentMinutes >= startMinutes && currentMinutes < endMinutes;

      if (inWindow) return this.toShiftResponse(shift);
    }

    return null;
  }

  /**
   * Player-facing: the Telebirr deposit details of the agent currently on
   * shift. Returns only the public info a depositing user needs
   * (full name + Telebirr phone number). Null when nobody is on shift.
   */
  async getActiveAgentDepositInfo(): Promise<{ displayName: string; phoneNumber: string | null } | null> {
    // The deposit destination is simply whichever agent the admin has on duty
    // (single primary). No timezone / schedule math — it's an explicit switch.
    const agent = await this.usersService.findOnDutyAgent();
    if (!agent) return null;

    // An on-duty agent still needs the deposit permission to receive deposits.
    if (agent.agentPermissions && agent.agentPermissions.deposit === false) return null;

    // An agent with a zero (or unfunded) wallet isn't shown as a deposit
    // destination — the admin hasn't allocated them float yet, so treat them
    // the same as not currently available.
    const balances = await this.walletService.getAvailableBalances([agent.id]);
    if ((balances.get(agent.id) ?? 0) <= 0) return null;

    return {
      displayName: agent.displayName,
      phoneNumber: agent.phoneNumber ?? null,
    };
  }

  /**
   * Player-facing: ALL agents currently on duty that can receive deposits — so the
   * player can CHOOSE who to send their Telebirr transfer to when more than one is
   * available. Returns public info only (id + name + Telebirr phone). Empty when
   * nobody is on duty. Deposit attribution is still driven by the receipt itself
   * (the verifier matches the recipient name/phone), so this is purely a chooser.
   * An agent whose wallet balance is zero is excluded — same reasoning as above.
   */
  async getActiveAgentsDepositInfo(): Promise<Array<{ id: string; displayName: string; phoneNumber: string | null }>> {
    const agents = await this.usersService.findOnDutyAgents();
    const eligible = agents.filter((a) => !(a.agentPermissions && a.agentPermissions.deposit === false));
    if (eligible.length === 0) return [];

    const balances = await this.walletService.getAvailableBalances(eligible.map((a) => a.id));
    return eligible
      .filter((a) => (balances.get(a.id) ?? 0) > 0)
      .map((a) => ({
        id: a.id,
        displayName: a.displayName,
        phoneNumber: a.phoneNumber ?? null,
      }));
  }

  /**
   * The requesting agent's own Bingo performance (Approach B): customers brought,
   * real-player activity in their rooms (bots excluded), GGR, and commission earned.
   */
  async getPerformance(agentId: string): Promise<{
    customersBrought: number;
    tickets: number;
    players: number;
    stakedMinor: number;
    payoutMinor: number;
    ggrMinor: number;
    commissionEarnedMinor: number;
    depositCount: number;
    depositVolumeMinor: number;
    depositCommissionEarnedMinor: number;
  }> {
    const q = (sql: string, params: unknown[]) => this.systemConfigRepository.query(sql, params);
    const [play] = await q(
      `SELECT COUNT(*) tickets, COUNT(DISTINCT t.userId) players,
              COALESCE(SUM(t.stakeMinor),0) staked, COALESCE(SUM(t.payoutMinor),0) payout
         FROM bingo_tickets t JOIN users pu ON pu.id = t.userId
        WHERE t.agentId = ? AND t.status <> 'cancelled'
          AND JSON_EXTRACT(pu.productMetadata, '$.botPolicy') IS NULL`,
      [agentId],
    );
    const [comm] = await q(
      `SELECT COALESCE(SUM(amountMinor),0) commission FROM ledger_entries
        WHERE userId = ? AND entryType = 'agent_receipt' AND sourceType = 'bingo_room_commission'`,
      [agentId],
    );
    const [cust] = await q(`SELECT COUNT(*) customers FROM users WHERE referredByAgentId = ?`, [agentId]);

    // Phase 4 — deposit activity the agent processed (volume/count from the
    // deposit-receipt action log), and the commission it earned them.
    const [dep] = await q(
      `SELECT COUNT(*) deposits, COALESCE(SUM(amountMinor),0) volume FROM agent_action_logs
        WHERE agentId = ? AND actionType IN ('telebirr_deposit_receipt','mpesa_deposit_receipt')`,
      [agentId],
    );
    const [depComm] = await q(
      `SELECT COALESCE(SUM(amountMinor),0) commission FROM ledger_entries
        WHERE userId = ? AND entryType = 'agent_receipt' AND sourceType = 'deposit_commission'`,
      [agentId],
    );

    const stakedMinor = Number(play?.staked ?? 0);
    const payoutMinor = Number(play?.payout ?? 0);
    return {
      customersBrought: Number(cust?.customers ?? 0),
      tickets: Number(play?.tickets ?? 0),
      players: Number(play?.players ?? 0),
      stakedMinor,
      payoutMinor,
      ggrMinor: stakedMinor - payoutMinor,
      commissionEarnedMinor: Number(comm?.commission ?? 0),
      depositCount: Number(dep?.deposits ?? 0),
      depositVolumeMinor: Number(dep?.volume ?? 0),
      depositCommissionEarnedMinor: Number(depComm?.commission ?? 0),
    };
  }

  private toShiftResponse(shift: AgentShift) {
    return {
      id: shift.id,
      agentId: shift.user ? {
        id: shift.user.id,
        displayName: shift.user.displayName,
        email: shift.user.email
      } : shift.agentId,
      startHour: shift.startHour,
      startMinute: shift.startMinute,
      endHour: shift.endHour,
      endMinute: shift.endMinute,
      daysOfWeek: shift.daysOfWeek,
      label: shift.label,
      isActive: shift.isActive,
      createdAt: shift.createdAt,
      updatedAt: shift.updatedAt
    };
  }
}
