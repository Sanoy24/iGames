import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createRequire } from 'module';
import {
  ParsedTelebirrReceipt,
  TelebirrReceiptPackage
} from './types/telebirr-receipt';
import { User } from '../users/schemas/user.schema';
import { TelebirrDeposit } from './schemas/telebirr-deposit.schema';

const loadCommonJsModule = createRequire(__filename);
const telebirrReceipt = loadCommonJsModule('telebirr-receipt') as TelebirrReceiptPackage;

export type VerifiedTelebirrReceipt = {
  receiptNo: string;
  amountMinor: number;
  parsedReceipt: ParsedTelebirrReceipt;
  verification: {
    receiverNameMatched: boolean | null;
    receiverAccountMatched: boolean | null;
    transactionStatusAccepted: boolean;
    expectedReceiverName?: string;
    expectedReceiverAccount?: string;
  };
  agentId?: Types.ObjectId;
};

import { AdminService } from '../admin/admin.service';

@Injectable()
export class TelebirrReceiptVerifierService {
  constructor(
    private readonly configService: ConfigService,
    private readonly adminService: AdminService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(TelebirrDeposit.name) private readonly telebirrDepositModel: Model<TelebirrDeposit>
  ) {}

  async verifyReceipt(receiptNoOrUrl: string, userId: string): Promise<VerifiedTelebirrReceipt> {
    const receiptNo = this.extractReceiptNo(receiptNoOrUrl);

    // Check database first
    const existing = await this.telebirrDepositModel.findOne({ receiptNo }).exec();
    if (existing) {
      if (existing.status === 'credited') {
        throw new BadRequestException('Telebirr receipt was already used');
      } else {
        throw new BadRequestException('Telebirr receipt was already rejected');
      }
    }

    const html = await this.loadReceipt(receiptNo);
    let parsedReceipt: ParsedTelebirrReceipt | undefined;

    try {
      parsedReceipt = telebirrReceipt.utils.parseFromHTML(html);
      return await this.verifyParsedReceipt(receiptNo, parsedReceipt);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) {
        const amountBirr = parsedReceipt?.settled_amount ?? parsedReceipt?.total_amount;
        let amountMinor = 0;
        try {
          if (amountBirr) {
            amountMinor = await this.toCreditMinor(amountBirr);
          }
        } catch {}

        // Find agent for logging
        let matchedAgentId: Types.ObjectId | undefined;
        try {
          const creditedName = parsedReceipt?.credited_party_name ?? parsedReceipt?.to;
          if (creditedName) {
            const normalizedCreditedName = this.normalize(creditedName);
            const agents = await this.userModel.find({ roles: 'agent', status: 'active' }).exec();
            const matchingAgent = agents.find(agent => this.normalize(agent.displayName) === normalizedCreditedName);
            if (matchingAgent) {
              matchedAgentId = matchingAgent._id;
            }
          }
        } catch {}

        await this.telebirrDepositModel.create({
          userId: new Types.ObjectId(userId),
          agentId: matchedAgentId,
          receiptNo,
          amountMinor,
          currencyCode: 'CREDIT',
          status: 'rejected',
          payerName: parsedReceipt?.payer_name,
          payerPhone: parsedReceipt?.payer_phone,
          creditedPartyName: parsedReceipt?.credited_party_name,
          creditedPartyAccount: parsedReceipt?.credited_party_acc_no,
          transactionStatus: parsedReceipt?.transaction_status,
          parsedReceipt: parsedReceipt || {} as any,
          verification: {
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          }
        }).catch(() => {});
      }
      throw error;
    }
  }

  async verifyParsedReceipt(
    submittedReceiptNo: string,
    parsedReceipt: ParsedTelebirrReceipt
  ): Promise<VerifiedTelebirrReceipt> {
    const receiptNo = parsedReceipt.receiptNo || submittedReceiptNo;
    if (!receiptNo) {
      throw new BadRequestException('Telebirr receipt number was not found');
    }

    const amountBirr = parsedReceipt.settled_amount ?? parsedReceipt.total_amount;
    if (typeof amountBirr !== 'number' || !Number.isFinite(amountBirr) || amountBirr <= 0) {
      throw new BadRequestException('Telebirr receipt amount is invalid');
    }

    const transactionStatusAccepted = this.isAcceptedTransactionStatus(
      parsedReceipt.transaction_status
    );
    if (!transactionStatusAccepted) {
      throw new BadRequestException('Telebirr transaction is not completed');
    }

    // Verify timeframe (date of transaction)
    if (!parsedReceipt.date) {
      throw new BadRequestException('Telebirr receipt is missing transaction date');
    }
    const txDate = new Date(parsedReceipt.date);
    if (isNaN(txDate.getTime())) {
      throw new BadRequestException('Telebirr receipt transaction date is invalid');
    }
    const now = new Date();
    const diffMs = now.getTime() - txDate.getTime();
    const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
    if (diffMs > MAX_AGE_MS) {
      throw new BadRequestException('Telebirr transaction is too old (exceeds 30 minutes)');
    }
    if (diffMs < -5 * 60 * 1000) {
      throw new BadRequestException('Telebirr transaction is in the future');
    }

    // Verify recipient name matches a registered agent, who is active and has deposit permission during transaction
    const creditedName = parsedReceipt.credited_party_name ?? parsedReceipt.to;
    if (!creditedName) {
      throw new BadRequestException('Telebirr receipt is missing credited party (receiver) name');
    }
    const normalizedCreditedName = this.normalize(creditedName);

    const agents = await this.userModel.find({ roles: 'agent', status: 'active' }).exec();
    const matchingAgent = agents.find(agent => this.normalize(agent.displayName) === normalizedCreditedName);

    if (!matchingAgent) {
      throw new BadRequestException(`No active agent found with name matching "${creditedName}"`);
    }

    if (matchingAgent.agentPermissions && matchingAgent.agentPermissions.deposit === false) {
      throw new BadRequestException(`Agent "${matchingAgent.displayName}" does not have deposit permission`);
    }

    // Check agent work timeframe at the time of transaction
    if (matchingAgent.workStartHour !== undefined && matchingAgent.workEndHour !== undefined) {
      const txMinutes = txDate.getHours() * 60 + txDate.getMinutes();
      const startMinutes = matchingAgent.workStartHour * 60 + (matchingAgent.workStartMinute || 0);
      const endMinutes = matchingAgent.workEndHour * 60 + (matchingAgent.workEndMinute || 0);

      const isOvernight = endMinutes <= startMinutes;
      const inWindow = isOvernight
        ? txMinutes >= startMinutes || txMinutes < endMinutes
        : txMinutes >= startMinutes && txMinutes < endMinutes;

      if (!inWindow) {
        const pad = (n: number) => String(n).padStart(2, '0');
        throw new BadRequestException(
          `Transaction occurred outside agent's working hours (${pad(matchingAgent.workStartHour)}:${pad(matchingAgent.workStartMinute || 0)} - ${pad(matchingAgent.workEndHour)}:${pad(matchingAgent.workEndMinute || 0)})`
        );
      }
    }

    return {
      receiptNo,
      amountMinor: await this.toCreditMinor(amountBirr),
      parsedReceipt,
      verification: {
        receiverNameMatched: true,
        receiverAccountMatched: true,
        transactionStatusAccepted,
        expectedReceiverName: matchingAgent.displayName
      },
      agentId: matchingAgent._id
    };
  }

  private async loadReceipt(receiptNo: string): Promise<string> {
    try {
      return await telebirrReceipt.utils.loadReceipt({ receiptNo });
    } catch (error) {
      throw new ServiceUnavailableException({
        message: 'Unable to load Telebirr receipt',
        detail: error instanceof Error ? error.message : 'Unknown Telebirr receipt error'
      });
    }
  }

  private extractReceiptNo(receiptNoOrUrl: string): string {
    const trimmed = receiptNoOrUrl.trim();
    if (!trimmed) {
      throw new BadRequestException('Telebirr receipt number is required');
    }

    if (!trimmed.startsWith('http')) {
      return this.validateReceiptNo(trimmed);
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new BadRequestException('Telebirr receipt URL is invalid');
    }

    if (url.hostname !== 'transactioninfo.ethiotelecom.et') {
      throw new BadRequestException('Telebirr receipt URL host is not allowed');
    }

    const receiptNo = url.pathname.split('/').filter(Boolean).at(-1);
    if (!receiptNo) {
      throw new BadRequestException('Telebirr receipt URL does not include a receipt number');
    }

    return this.validateReceiptNo(receiptNo);
  }

  private validateReceiptNo(receiptNo: string): string {
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(receiptNo)) {
      throw new BadRequestException('Telebirr receipt number is invalid');
    }
    return receiptNo;
  }

  private isAcceptedTransactionStatus(status: string | undefined): boolean {
    if (!status) {
      return false;
    }
    return ['completed', 'success', 'successful', 'paid'].some((accepted) =>
      status.toLowerCase().includes(accepted)
    );
  }

  private matchOptionalField(
    parsedValue: string | undefined,
    expectedValue: string | undefined
  ): boolean | null {
    if (!expectedValue) {
      return null;
    }
    if (!parsedValue) {
      return false;
    }
    return this.normalize(parsedValue) === this.normalize(expectedValue);
  }

  private normalize(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private async toCreditMinor(amountBirr: number): Promise<number> {
    const systemConfig = await this.adminService.getSystemConfig();
    const multiplier = systemConfig.telebirrCreditMinorPerBirr || 100;

    const amountMinor = Math.round(amountBirr * multiplier);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Telebirr converted wallet amount is invalid');
    }
    return amountMinor;
  }
}
