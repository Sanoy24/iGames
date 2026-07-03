import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createRequire } from 'module';
import {
  ParsedTelebirrReceipt,
  TelebirrReceiptPackage
} from './types/telebirr-receipt';
import { User } from '../users/entities/user.entity';
import { TelebirrDeposit } from './entities/telebirr-deposit.entity';
import { AdminService } from '../admin/admin.service';

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
  agentId?: string;
};

@Injectable()
export class TelebirrReceiptVerifierService {
  constructor(
    private readonly configService: ConfigService,
    private readonly adminService: AdminService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TelebirrDeposit)
    private readonly telebirrDepositRepository: Repository<TelebirrDeposit>
  ) {}

  async verifyReceipt(receiptNoOrUrl: string, userId: string): Promise<VerifiedTelebirrReceipt> {
    const receiptNo = this.extractReceiptNo(receiptNoOrUrl);

    // Check database first
    const existing = await this.telebirrDepositRepository.findOneBy({ receiptNo });
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
        let matchedAgentId: string | undefined;
        try {
          const creditedName = parsedReceipt?.credited_party_name ?? parsedReceipt?.to;
          if (creditedName) {
            const normalizedCreditedName = this.normalize(creditedName);
            const agents = await this.userRepository.createQueryBuilder('user')
              .where('user.status = :status', { status: 'active' })
              .andWhere('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
              .getMany();
            const matchingAgent = agents.find(agent => this.normalize(agent.displayName) === normalizedCreditedName);
            if (matchingAgent) {
              matchedAgentId = matchingAgent.id;
            }
          }
        } catch {}

        const deposit = this.telebirrDepositRepository.create({
          userId,
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
          parsedReceipt: parsedReceipt || {},
          verification: {
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          }
        });
        await this.telebirrDepositRepository.save(deposit).catch(() => {});
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

    const agents = await this.userRepository.createQueryBuilder('user')
      .where('user.status = :status', { status: 'active' })
      .andWhere('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
      .getMany();
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
      agentId: matchingAgent.id
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

  private normalize(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private async toCreditMinor(amountBirr: number): Promise<number> {
    const systemConfig = await this.adminService.getSystemConfig();
    // Flat 1:1 wallet model — 1 Birr deposited credits 1 ETB. The multiplier
    // stays configurable, but defaults to 1 (not 100) so a 10 Birr top-up
    // credits exactly 10, matching how balances are displayed everywhere.
    const multiplier = systemConfig.telebirrCreditMinorPerBirr || 1;

    const amountMinor = Math.round(amountBirr * multiplier);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Telebirr converted wallet amount is invalid');
    }
    return amountMinor;
  }
}
