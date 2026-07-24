import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AdminService } from '../admin/admin.service';
import { MpesaDeposit } from './entities/mpesa-deposit.entity';
import { parseMpesaSms, ParsedMpesaSms } from './mpesa-sms-parser';
import { MpesaReceiptClientService } from './mpesa-receipt-client.service';
import { accountMatchesPhone, checkFreshness, normalizeName } from './receipt-verification';

/** Evidence from the authoritative portal receipt (when a cross-check ran). */
export type MpesaPortalEvidence = {
  checked: boolean;
  success?: boolean;
  code?: string;
  amountMatched?: boolean;
  receiverMatched?: boolean | null;
  receiverPhone?: string;
  receiverName?: string;
};

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
    portal?: MpesaPortalEvidence;
  };
  agentId: string;
};

@Injectable()
export class MpesaReceiptVerifierService {
  private readonly logger = new Logger(MpesaReceiptVerifierService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly adminService: AdminService,
    private readonly receiptClient: MpesaReceiptClientService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(MpesaDeposit)
    private readonly mpesaDepositRepository: Repository<MpesaDeposit>,
  ) {}

  /** When true, an unreachable portal blocks the deposit (like Telebirr). */
  private get portalStrict(): boolean {
    return this.configService.get<boolean>('MPESA_PORTAL_STRICT') === true;
  }

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

    // Authoritative cross-check against the portal receipt PDF (unmasked). When it
    // runs, its amount/receiver are the source of truth over the masked SMS.
    const portal = await this.crossCheckPortal(parsed, matchingAgent);

    const amountMinor = await this.toCreditMinor(parsed.amountBirr);

    return {
      confirmationCode: parsed.confirmationCode,
      amountMinor,
      parsedSms: parsed,
      verification: {
        receiverNameMatched: true,
        // Prefer the portal's unmasked receiver match when we have it.
        receiverAccountMatched: portal.checked ? portal.receiverMatched ?? receiverAccountMatched : receiverAccountMatched,
        transactionStatusAccepted: true, // an M-PESA "Confirmed" SMS is a completed txn
        expectedReceiverName: matchingAgent.displayName,
        expectedReceiverAccount: matchingAgent.phoneNumber ?? undefined,
        portalChecked: portal.checked,
        portal,
      },
      agentId: matchingAgent.id,
    };
  }

  /**
   * Authoritative portal cross-check — the M-PESA analogue of fetching a Telebirr
   * receipt. Off unless a portal is configured (MPESA_PORTAL_URL). When on, it
   * fetches the real receipt PDF (GET /api/receipt/getReceipt?trxNo=…), which is
   * UNMASKED, and requires it to confirm the pasted SMS:
   *   • the transaction resolves and is successful (responseCode "0"),
   *   • the settled amount equals the SMS amount,
   *   • the (unmasked) receiver is this agent.
   * A definite conflict is REJECTED. A "not found / not successful" is REJECTED (the
   * code isn't a real settled transaction). A portal OUTAGE falls back to the SMS
   * unless MPESA_PORTAL_STRICT is on, in which case it blocks (like Telebirr).
   */
  private async crossCheckPortal(
    parsed: ParsedMpesaSms,
    agent: User,
  ): Promise<MpesaPortalEvidence> {
    if (!this.receiptClient.isConfigured) return { checked: false };

    let receipt;
    try {
      receipt = await this.receiptClient.fetchParsed(parsed.receiptUrl ?? parsed.confirmationCode);
    } catch (error) {
      // A definite "not found / not successful" is a hard reject.
      if (error instanceof BadRequestException) {
        throw new BadRequestException(`M-PESA portal could not confirm this receipt: ${error.message}`);
      }
      // Portal outage: block only in strict mode; otherwise fall back to the SMS.
      if (this.portalStrict) throw error;
      this.logger.warn(
        `M-PESA portal unreachable; falling back to SMS for ${parsed.confirmationCode}: ${error instanceof Error ? error.message : error}`,
      );
      return { checked: false };
    }

    // Settled amount must match the SMS (tolerate float noise).
    const amountMatched =
      receipt.amountBirr != null && Math.abs(receipt.amountBirr - parsed.amountBirr) < 0.005;
    if (receipt.amountBirr != null && !amountMatched) {
      throw new BadRequestException(
        `M-PESA receipt amount (${receipt.amountBirr} Birr) does not match the SMS (${parsed.amountBirr} Birr)`,
      );
    }

    // The unmasked receiver must be THIS agent's number.
    const receiverMatched = accountMatchesPhone(receipt.receiverPhone, agent.phoneNumber);
    if (receiverMatched === false) {
      throw new BadRequestException(
        `M-PESA receipt shows the money went to ${receipt.receiverPhone ?? 'another number'}, ` +
          `not agent "${agent.displayName}"`,
      );
    }

    return {
      checked: true,
      success: receipt.success,
      code: receipt.code,
      amountMatched,
      receiverMatched,
      receiverPhone: receipt.receiverPhone,
      receiverName: receipt.receiverName,
    };
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
