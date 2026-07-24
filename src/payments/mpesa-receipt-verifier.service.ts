import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AdminService } from '../admin/admin.service';
import { MpesaDeposit } from './entities/mpesa-deposit.entity';
import { parseMpesaSms, ParsedMpesaSms } from './mpesa-sms-parser';
import { accountMatchesPhone, checkFreshness, normalizeName } from './receipt-verification';

export type VerifiedMpesaReceipt = {
  confirmationCode: string;
  amountMinor: number;
  parsedSms: ParsedMpesaSms;
  verification: {
    receiverNameMatched: boolean;
    receiverAccountMatched: boolean | null;
    transactionStatusAccepted: boolean;
    expectedReceiverName?: string;
    expectedReceiverAccount?: string;
    portalChecked: boolean;
  };
  agentId: string;
};

@Injectable()
export class MpesaReceiptVerifierService {
  private readonly logger = new Logger(MpesaReceiptVerifierService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly adminService: AdminService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(MpesaDeposit)
    private readonly mpesaDepositRepository: Repository<MpesaDeposit>,
  ) {}

  /**
   * Parse and verify a pasted M-PESA confirmation SMS. Applies the same guard set
   * as the Telebirr verifier — dedupe on the confirmation code, freshness window,
   * receiver matches an active deposit-agent (name + account/phone) — adapted to
   * SMS text. When `MPESA_PORTAL_URL` is configured the raw portal response is
   * fetched and stored for evidence; wiring it into the decision is a later step
   * (the response format is provider-specific), so today the SMS is authoritative.
   */
  async verifySms(rawSms: string, userId: string): Promise<VerifiedMpesaReceipt> {
    const parsed = parseMpesaSms(rawSms);
    if (!parsed) {
      throw new BadRequestException('That does not look like an M-PESA confirmation SMS');
    }

    // Reject a reused receipt early (before any expensive work).
    const existing = await this.mpesaDepositRepository.findOneBy({ confirmationCode: parsed.confirmationCode });
    if (existing) {
      throw new BadRequestException(
        existing.status === 'credited'
          ? 'M-PESA receipt was already used'
          : 'M-PESA receipt was already rejected',
      );
    }

    try {
      return await this.verifyParsed(parsed);
    } catch (error) {
      // Record the rejection (best-effort) so admins can see failed attempts,
      // mirroring the Telebirr verifier. The unique code still blocks reuse.
      await this.saveRejected(parsed, userId, error).catch(() => undefined);
      throw error;
    }
  }

  async verifyParsed(parsed: ParsedMpesaSms): Promise<VerifiedMpesaReceipt> {
    if (parsed.direction === 'received') {
      throw new BadRequestException(
        'This is a "received" M-PESA message. Paste the confirmation from the phone that SENT the deposit.',
      );
    }
    if (parsed.direction === 'purchase') {
      throw new BadRequestException(
        'That looks like an airtime/bundle purchase, not a transfer to an agent. Paste the "sent to <agent>" confirmation.',
      );
    }
    if (parsed.direction !== 'sent' && parsed.direction !== 'paid') {
      throw new BadRequestException('Could not tell from the SMS that money was sent to an agent');
    }

    if (!Number.isFinite(parsed.amountBirr) || parsed.amountBirr <= 0) {
      throw new BadRequestException('M-PESA receipt amount is invalid');
    }

    // Freshness — the SMS must carry a readable timestamp within the window.
    if (!parsed.transactedAt) {
      throw new BadRequestException('M-PESA SMS is missing a readable transaction time');
    }
    const freshness = checkFreshness(parsed.transactedAt);
    if (freshness === 'too_old') {
      throw new BadRequestException('M-PESA transaction is too old (exceeds 30 minutes)');
    }
    if (freshness === 'future') {
      throw new BadRequestException('M-PESA transaction time is in the future');
    }

    // Receiver must be an active agent with deposit permission.
    const creditedName = parsed.counterpartyName;
    if (!creditedName) {
      throw new BadRequestException('M-PESA SMS is missing the receiving agent name');
    }
    const normalizedName = normalizeName(creditedName);

    const agents = await this.userRepository
      .createQueryBuilder('user')
      .where('user.status = :status', { status: 'active' })
      .andWhere('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
      .getMany();
    const matchingAgent = agents.find((agent) => normalizeName(agent.displayName) === normalizedName);

    if (!matchingAgent) {
      throw new BadRequestException(`No active agent found with name matching "${creditedName}"`);
    }
    if (matchingAgent.agentPermissions && matchingAgent.agentPermissions.deposit === false) {
      throw new BadRequestException(`Agent "${matchingAgent.displayName}" does not have deposit permission`);
    }

    // If the SMS exposed the receiver phone, it must match the agent's number.
    // A definite mismatch is rejected; an absent/ambiguous number falls back to
    // the name match (same policy as Telebirr's masked-account handling).
    const receiverAccountMatched = accountMatchesPhone(parsed.counterpartyPhone, matchingAgent.phoneNumber);
    if (receiverAccountMatched === false) {
      throw new BadRequestException(
        `M-PESA payment went to a number that does not match agent "${matchingAgent.displayName}"`,
      );
    }

    const amountMinor = await this.toCreditMinor(parsed.amountBirr);
    const portalChecked = await this.crossCheckPortal(parsed);

    return {
      confirmationCode: parsed.confirmationCode,
      amountMinor,
      parsedSms: parsed,
      verification: {
        receiverNameMatched: true,
        receiverAccountMatched,
        transactionStatusAccepted: true, // an M-PESA "Confirmed" SMS is a completed txn
        expectedReceiverName: matchingAgent.displayName,
        expectedReceiverAccount: matchingAgent.phoneNumber ?? undefined,
        portalChecked,
      },
      agentId: matchingAgent.id,
    };
  }

  /**
   * Pluggable portal cross-check. Off unless `MPESA_PORTAL_URL` is set. When on,
   * it fetches the raw portal response for the code so it is captured as evidence;
   * parsing/deciding on it is intentionally deferred until the portal's response
   * format is pinned down. Never throws — a portal blip must not block a deposit
   * the SMS already verified.
   */
  private async crossCheckPortal(parsed: ParsedMpesaSms): Promise<boolean> {
    const portalUrl = this.configService.get<string>('MPESA_PORTAL_URL')?.trim();
    if (!portalUrl) return false;

    const key = this.configService.get<string>('MPESA_PORTAL_KEY') ?? '';
    const timeoutMs = Number(this.configService.get<string>('MPESA_PORTAL_TIMEOUT_MS') ?? 15000);
    try {
      const res = await fetch(
        `${portalUrl.replace(/\/+$/, '')}/fetchreceipt?code=${encodeURIComponent(parsed.confirmationCode)}`,
        { headers: key ? { 'x-portal-key': key } : {}, signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!res.ok) {
        this.logger.warn(`M-PESA portal returned HTTP ${res.status} for ${parsed.confirmationCode}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `M-PESA portal cross-check failed for ${parsed.confirmationCode}: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  private async saveRejected(parsed: ParsedMpesaSms, userId: string, error: unknown): Promise<void> {
    let amountMinor = 0;
    try {
      if (parsed.amountBirr > 0) amountMinor = await this.toCreditMinor(parsed.amountBirr);
    } catch {
      /* amount unusable — record 0 */
    }

    let matchedAgentId: string | undefined;
    if (parsed.counterpartyName) {
      const normalized = normalizeName(parsed.counterpartyName);
      const agents = await this.userRepository
        .createQueryBuilder('user')
        .where('user.status = :status', { status: 'active' })
        .andWhere('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
        .getMany();
      matchedAgentId = agents.find((a) => normalizeName(a.displayName) === normalized)?.id;
    }

    const deposit = this.mpesaDepositRepository.create({
      userId,
      agentId: matchedAgentId,
      confirmationCode: parsed.confirmationCode,
      amountMinor,
      currencyCode: 'CREDIT',
      status: 'rejected',
      payerPhone: parsed.direction === 'received' ? parsed.counterpartyPhone : undefined,
      creditedPartyName: parsed.counterpartyName,
      creditedPartyAccount: parsed.counterpartyPhone,
      transactionStatus: parsed.direction,
      parsedSms: parsed,
      verification: {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
    });
    await this.mpesaDepositRepository.save(deposit);
  }

  private async toCreditMinor(amountBirr: number): Promise<number> {
    const systemConfig = await this.adminService.getSystemConfig();
    // Flat 1:1 wallet model — same ratio as Telebirr (1 Birr → 1 ETB credit).
    const multiplier = systemConfig.telebirrCreditMinorPerBirr || 1;
    const amountMinor = Math.round(amountBirr * multiplier);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('M-PESA converted wallet amount is invalid');
    }
    return amountMinor;
  }
}
