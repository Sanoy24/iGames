import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { AgentShift } from './entities/agent-shift.entity';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UsersService } from '../users/users.service';
import { SystemConfig } from '../admin/entities/system-config.entity';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(AgentShift)
    private readonly agentShiftRepository: Repository<AgentShift>,
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
    private readonly walletService: WalletService,
    private readonly usersService: UsersService,
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
   * Unified agent gate: an agent may only act while the admin has them **on duty**,
   * and only for actions their permissions allow. Replaces the old timezone-based
   * working-hours window (which broke when the server clock wasn't Ethiopia time).
   */
  verifyAgentWorkingHoursAndPermission(agent: any, permission: 'deposit' | 'withdraw') {
    // 1. Must be on duty (admin-controlled).
    if (!agent.isOnDuty) {
      throw new BadRequestException('You are not on duty. Ask an admin to put you on duty.');
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

  async completeWithdrawal(withdrawalId: string, agentId: string, telebirrReference: string) {
    const agent = await this.usersService.findById(agentId);
    this.verifyAgentWorkingHoursAndPermission(agent, 'withdraw');
    // Read fee/commission split and the designated super-admin from system config.
    const config = await this.systemConfigRepository.findOneBy({ key: 'global' });
    const serviceFeePct = config?.withdrawalServiceChargePct ?? 0;
    const commissionPct = config?.withdrawalCommissionPct ?? 0;
    const superAdminUserId = config?.superAdminUserId ?? null;

    return this.walletService.completeWithdrawalByAgent({
      withdrawalId,
      agentId,
      telebirrReference,
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

    return {
      displayName: agent.displayName,
      phoneNumber: agent.phoneNumber ?? null,
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
