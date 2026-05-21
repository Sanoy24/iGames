import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { WalletService } from '../wallet/wallet.service';
import { AgentShift, AgentShiftDocument } from './schemas/agent-shift.schema';
import { CreateShiftDto } from './dto/create-shift.dto';

@Injectable()
export class AgentsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(AgentShift.name) private readonly shiftModel: Model<AgentShift>,
    private readonly walletService: WalletService,
  ) {}

  // ── Withdrawals ────────────────────────────────────────────────────

  getAvailableWithdrawals() {
    return this.walletService.getAvailableWithdrawals();
  }

  getMyWithdrawals(agentId: string) {
    return this.walletService.getAgentWithdrawals(agentId);
  }

  claimWithdrawal(withdrawalId: string, agentId: string) {
    return this.walletService.claimWithdrawal(withdrawalId, agentId);
  }

  releaseWithdrawal(withdrawalId: string, agentId: string) {
    return this.walletService.releaseWithdrawal(withdrawalId, agentId);
  }

  async completeWithdrawal(withdrawalId: string, agentId: string, telebirrReference: string) {
    // Read service charge from system config directly to avoid circular module deps.
    const config = await this.connection
      .collection('systemconfigs')
      .findOne({ key: 'global' });
    const serviceChargePct = (config?.withdrawalServiceChargePct as number) ?? 0;

    return this.walletService.completeWithdrawalByAgent({
      withdrawalId,
      agentId,
      telebirrReference,
      serviceChargePct,
    });
  }

  // ── Shifts ─────────────────────────────────────────────────────────

  async createShift(dto: CreateShiftDto): Promise<AgentShiftDocument> {
    const [shift] = await this.shiftModel.create([
      {
        agentId: new Types.ObjectId(dto.agentId),
        startHour: dto.startHour,
        startMinute: dto.startMinute,
        endHour: dto.endHour,
        endMinute: dto.endMinute,
        daysOfWeek: dto.daysOfWeek ?? [],
        label: dto.label,
        isActive: dto.isActive ?? true,
      },
    ]);
    return shift;
  }

  listShifts(): Promise<AgentShiftDocument[]> {
    return this.shiftModel
      .find()
      .populate('agentId', 'displayName email')
      .sort({ startHour: 1, startMinute: 1 })
      .exec();
  }

  async updateShift(shiftId: string, dto: Partial<CreateShiftDto>): Promise<AgentShiftDocument> {
    const update: Record<string, unknown> = {};
    if (dto.agentId !== undefined) update.agentId = new Types.ObjectId(dto.agentId);
    if (dto.startHour !== undefined) update.startHour = dto.startHour;
    if (dto.startMinute !== undefined) update.startMinute = dto.startMinute;
    if (dto.endHour !== undefined) update.endHour = dto.endHour;
    if (dto.endMinute !== undefined) update.endMinute = dto.endMinute;
    if (dto.daysOfWeek !== undefined) update.daysOfWeek = dto.daysOfWeek;
    if (dto.label !== undefined) update.label = dto.label;
    if (dto.isActive !== undefined) update.isActive = dto.isActive;

    const shift = await this.shiftModel
      .findByIdAndUpdate(shiftId, { $set: update }, { new: true })
      .populate('agentId', 'displayName email')
      .exec();

    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async deleteShift(shiftId: string): Promise<void> {
    await this.shiftModel.findByIdAndDelete(shiftId).exec();
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

    const shifts = await this.shiftModel.find({ isActive: true }).exec();

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
        return shift.agentId.toString();
      }
    }

    return null;
  }

  async getActiveShift(): Promise<AgentShiftDocument | null> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const shifts = await this.shiftModel
      .find({ isActive: true })
      .populate('agentId', 'displayName email')
      .exec();

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

      if (inWindow) return shift;
    }

    return null;
  }
}
