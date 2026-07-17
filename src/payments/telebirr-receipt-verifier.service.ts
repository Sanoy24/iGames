import {
  BadRequestException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(TelebirrReceiptVerifierService.name);

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

    // Verify the money actually landed on THIS agent's Telebirr account, not just a
    // coincidentally matching display name. Telebirr masks the account number, so
    // we compare the visible digits: a definite mismatch is rejected; a fully-masked
    // (indeterminate) account falls back to the name match.
    const receiverAccountMatched = this.accountMatchesPhone(
      parsedReceipt.credited_party_acc_no,
      matchingAgent.phoneNumber,
    );
    if (receiverAccountMatched === false) {
      throw new BadRequestException(
        `Telebirr payment went to an account that does not match agent "${matchingAgent.displayName}"`,
      );
    }

    // Minimum-deposit enforcement lives in PaymentsService.assertMeetsMinimum so
    // both the preview and submit paths reject below-minimum receipts with one
    // clear message.
    const amountMinor = await this.toCreditMinor(amountBirr);

    return {
      receiptNo,
      amountMinor,
      parsedReceipt,
      verification: {
        receiverNameMatched: true,
        receiverAccountMatched,
        transactionStatusAccepted,
        expectedReceiverName: matchingAgent.displayName,
        expectedReceiverAccount: matchingAgent.phoneNumber ?? undefined,
      },
      agentId: matchingAgent.id
    };
  }

  /**
   * Does the receipt's (usually masked) credited account belong to `agentPhone`?
   * Returns true (match), false (definite mismatch → reject), or null (can't tell,
   * e.g. fully masked → fall back to the name match). Telebirr shows the account
   * like `251912***789` / `0912****4321`; we compare the visible trailing digits,
   * and do a full compare when the account is not masked at all.
   */
  private accountMatchesPhone(receiptAcc?: string, agentPhone?: string): boolean | null {
    if (!receiptAcc || !agentPhone) return null;
    // Canonical 9-digit local number (9XXXXXXXX), stripping +251 / 0 prefixes.
    const phoneTail = agentPhone.replace(/\D/g, '').slice(-9);
    if (phoneTail.length < 9) return null;

    const isMasked = /[*xX•·.]/.test(receiptAcc.replace(/^\+?251|^0/, ''));
    const accDigits = receiptAcc.replace(/\D/g, '');

    // Not masked → compare the full local number.
    if (!isMasked && accDigits.length >= 9) {
      return accDigits.slice(-9) === phoneTail;
    }

    // Masked → compare the visible trailing run of digits (Telebirr reliably shows
    // the last few). Require ≥3 to be meaningful.
    const trailing = receiptAcc.match(/(\d+)\D*$/)?.[1] ?? '';
    if (trailing.length >= 3) {
      return phoneTail.endsWith(trailing.slice(-9));
    }
    return null;
  }

  /**
   * Diagnostic probe (no DB write, no credit): fetch + parse a receipt so an ops
   * self-test can confirm the server can actually reach and read Ethiotelecom.
   */
  async probeReceipt(receiptNo: string): Promise<{
    loaded: boolean;
    parsed: boolean;
    amount?: number;
    receiver?: string;
    receiverAccount?: string;
    transactionStatus?: string;
    error?: string;
  }> {
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(receiptNo)) {
      return { loaded: false, parsed: false, error: 'Receipt number format is invalid' };
    }
    let html: string;
    try {
      html = await this.loadReceipt(receiptNo);
    } catch (error) {
      const detail = (error as { response?: { detail?: string } })?.response?.detail;
      return { loaded: false, parsed: false, error: detail ?? (error instanceof Error ? error.message : String(error)) };
    }
    try {
      const parsed = telebirrReceipt.utils.parseFromHTML(html);
      return {
        loaded: true,
        parsed: true,
        amount: parsed.settled_amount ?? parsed.total_amount,
        receiver: parsed.credited_party_name ?? parsed.to,
        receiverAccount: parsed.credited_party_acc_no,
        transactionStatus: parsed.transaction_status,
      };
    } catch (error) {
      return { loaded: true, parsed: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadReceipt(receiptNo: string): Promise<string> {
    // When TELEBIRR_PROXY_URL is configured, fetch the receipt HTML through the
    // egress proxy (services/telebirr-proxy) instead of hitting Ethiotelecom
    // directly — for hosts that cannot reach transactioninfo.ethiotelecom.et.
    // Blank = direct fetch (historical behaviour), so this is an on/off env switch.
    const proxyUrl = this.configService.get<string>('TELEBIRR_PROXY_URL')?.trim();
    const started = Date.now();
    try {
      if (proxyUrl) {
        const html = await this.loadReceiptViaProxy(proxyUrl.replace(/\/+$/, ''), receiptNo);
        this.logger.log(`Receipt loaded via PROXY in ${Date.now() - started}ms (${html.length} bytes)`);
        return html;
      }
      this.logger.warn('TELEBIRR_PROXY_URL is not set — fetching Ethiotelecom DIRECTLY');
      const html = await telebirrReceipt.utils.loadReceipt({ receiptNo });
      this.logger.log(`Receipt loaded DIRECT in ${Date.now() - started}ms`);
      return html;
    } catch (error) {
      this.logger.error(
        `Receipt load FAILED after ${Date.now() - started}ms (proxy=${proxyUrl ? 'on' : 'off'}): ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException({
        message: 'Unable to load Telebirr receipt',
        detail: error instanceof Error ? error.message : 'Unknown Telebirr receipt error'
      });
    }
  }

  private async loadReceiptViaProxy(baseUrl: string, receiptNo: string): Promise<string> {
    const key = this.configService.get<string>('TELEBIRR_PROXY_KEY') ?? '';
    const timeoutMs = Number(this.configService.get<string>('TELEBIRR_PROXY_TIMEOUT_MS') ?? 15000);

    // GET ${baseUrl}/fetchreceipt?receiptNo=... — the proxy replies { html }.
    // (An optional x-proxy-key header is sent when TELEBIRR_PROXY_KEY is set; the
    // proxy may ignore it.)
    const response = await fetch(
      `${baseUrl}/fetchreceipt?receiptNo=${encodeURIComponent(receiptNo)}`,
      {
        headers: key ? { 'x-proxy-key': key } : {},
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(`Telebirr proxy returned HTTP ${response.status}`);
    }
    const data = (await response.json()) as { html?: string };
    if (!data?.html) {
      throw new Error('Telebirr proxy returned no receipt HTML');
    }
    return data.html;
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
