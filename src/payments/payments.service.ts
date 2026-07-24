import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminService } from '../admin/admin.service';
import { AgentActionLog } from '../agents/entities/agent-action-log.entity';
import { User } from '../users/entities/user.entity';
import { SubmitTelebirrReceiptDto } from './dto/submit-telebirr-receipt.dto';
import { SubmitMpesaSmsDto } from './dto/submit-mpesa-sms.dto';
import { TelebirrDeposit } from './entities/telebirr-deposit.entity';
import { MpesaDeposit } from './entities/mpesa-deposit.entity';
import { TelebirrReceiptVerifierService } from './telebirr-receipt-verifier.service';
import { MpesaReceiptVerifierService } from './mpesa-receipt-verifier.service';
import { computeDepositCommissionMinor } from './deposit-commission';

export type TelebirrReceiptPreview = {
  receiptNo: string;
  amountMinor: number;
  payerName?: string;
  payerPhone?: string;
  receiverName?: string;
  transactionStatus?: string;
  date?: string;
};

export type TelebirrDepositResponse = {
  id: string;
  receiptNo: string;
  amountMinor: number;
  currencyCode: string;
  status: string;
  agentId?: string;
  walletCredit?: Record<string, unknown>;
  parsedReceipt: Record<string, unknown>;
  verification: Record<string, unknown>;
};

export type MpesaReceiptPreview = {
  confirmationCode: string;
  amountMinor: number;
  payerPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
  date?: string;
};

export type MpesaDepositResponse = {
  id: string;
  confirmationCode: string;
  amountMinor: number;
  currencyCode: string;
  status: string;
  agentId?: string;
  walletCredit?: Record<string, unknown>;
  parsedSms: Record<string, unknown>;
  verification: Record<string, unknown>;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TelebirrDeposit)
    private readonly telebirrDepositRepository: Repository<TelebirrDeposit>,
    @InjectRepository(MpesaDeposit)
    private readonly mpesaDepositRepository: Repository<MpesaDeposit>,
    private readonly telebirrReceiptVerifierService: TelebirrReceiptVerifierService,
    private readonly mpesaReceiptVerifierService: MpesaReceiptVerifierService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly adminService: AdminService,
  ) {}

  /** Player-facing deposit rules (currently just the admin-set minimum). */
  async getPublicConfig(): Promise<{ minDepositMinor: number }> {
    const config = await this.adminService.getSystemConfig();
    return { minDepositMinor: config.minDepositMinor ?? 0 };
  }

  /**
   * Ops self-test: can THIS server reach Ethiotelecom's receipt service? Telebirr
   * deposits depend entirely on fetching the real receipt, so if the host (e.g. a
   * locked-down cPanel box) can't make the outbound request, every deposit fails.
   * Optionally pass a real `receipt` id to also test the full fetch + parse path.
   */
  async telebirrHealth(receipt?: string): Promise<Record<string, unknown>> {
    const host = 'https://transactioninfo.ethiotelecom.et/';
    const hostname = 'transactioninfo.ethiotelecom.et';

    // Step 1: DNS. Distinguishes "can't resolve the name" from "resolves but the
    // connection is blocked" — different fixes when talking to the host provider.
    let dns: Record<string, unknown>;
    const dnsStart = Date.now();
    try {
      const { lookup } = await import('node:dns/promises');
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('DNS lookup timed out')), 5000),
      );
      const { address } = (await Promise.race([lookup(hostname), timeout])) as { address: string };
      dns = { resolved: true, address, latencyMs: Date.now() - dnsStart };
    } catch (error) {
      dns = {
        resolved: false,
        latencyMs: Date.now() - dnsStart,
        error: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string })?.code,
      };
    }

    // Step 2: HTTPS connect.
    const startedAt = Date.now();
    let connectivity: Record<string, unknown>;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res: { status: number } = await (globalThis as {
        fetch: (u: string, o: unknown) => Promise<{ status: number }>;
      }).fetch(host, { method: 'GET', redirect: 'manual', signal: controller.signal });
      clearTimeout(timer);
      connectivity = { reachable: true, httpStatus: res.status, latencyMs: Date.now() - startedAt };
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code
        ?? (error as { name?: string })?.name;
      connectivity = {
        reachable: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        code,
      };
    }

    let verdict: string;
    if (connectivity.reachable) {
      verdict = 'OK — this server can reach Ethiotelecom; Telebirr deposits should work.';
    } else if (!dns.resolved) {
      verdict = 'DNS FAILED — the server cannot resolve the Ethiotelecom hostname. Ask the host to allow DNS resolution (or set a working resolver like 8.8.8.8).';
    } else {
      verdict = 'BLOCKED — DNS resolves but the outbound HTTPS connection is dropped (timeout). Ask the host to allow outbound TCP 443 to transactioninfo.ethiotelecom.et. Deposits will fail until then.';
    }

    const result: Record<string, unknown> = {
      host,
      checkedAt: new Date().toISOString(),
      dns,
      connectivity,
      verdict,
    };
    if (receipt) {
      result.receiptProbe = await this.telebirrReceiptVerifierService.probeReceipt(receipt);
    }
    return result;
  }

  /** Throws if the amount is below the admin-configured minimum deposit. */
  private async assertMeetsMinimum(amountMinor: number): Promise<void> {
    const config = await this.adminService.getSystemConfig();
    const min = config.minDepositMinor ?? 0;
    if (min > 0 && amountMinor < min) {
      throw new BadRequestException(
        `The minimum deposit is ${min.toLocaleString()} ETB. This receipt is for ${amountMinor.toLocaleString()} ETB.`,
      );
    }
  }

  /**
   * Phase 4 — agent deposit commission. When a deposit that is attributed to an
   * agent is credited, pay that agent a configured % of the deposit as commission,
   * in the SAME transaction as the player credit (never a wallet mutation without a
   * ledger entry). Idempotent on the deposit reference, so a duplicate submit or a
   * retry can never double-pay. No-op when the rate is 0 or rounds to nothing.
   */
  private async creditAgentDepositCommission(
    manager: EntityManager,
    input: {
      agentId: string;
      userId: string;
      provider: 'telebirr' | 'mpesa';
      reference: string;
      depositAmountMinor: number;
      depositCommissionPct: number;
    },
  ): Promise<number> {
    const commissionMinor = computeDepositCommissionMinor(input.depositAmountMinor, input.depositCommissionPct);
    if (commissionMinor <= 0) return 0;

    await this.walletService.ensureDefaultWallet(input.agentId, manager);
    await this.walletService.creditInSession(
      {
        userId: input.agentId,
        amountMinor: commissionMinor,
        entryType: 'agent_receipt',
        sourceType: 'deposit_commission',
        sourceId: input.reference,
        idempotencyKey: `deposit-commission:${input.provider}:${input.reference}`,
        metadata: {
          provider: input.provider,
          reference: input.reference,
          userId: input.userId,
          depositAmountMinor: input.depositAmountMinor,
          depositCommissionPct: input.depositCommissionPct,
          kind: 'deposit_commission',
        },
      },
      manager,
    );
    return commissionMinor;
  }

  async previewTelebirrReceipt(
    userId: string,
    dto: SubmitTelebirrReceiptDto,
  ): Promise<TelebirrReceiptPreview> {
    const submittedReceipt = dto.receiptNo ?? dto.receiptUrl;
    if (!submittedReceipt) {
      throw new ConflictException('receiptNo or receiptUrl is required');
    }
    const verified = await this.telebirrReceiptVerifierService.verifyReceipt(submittedReceipt, userId);
    // Reject below-minimum receipts at the verify step so the player is told
    // before they try to confirm the deposit.
    await this.assertMeetsMinimum(verified.amountMinor);
    const p = verified.parsedReceipt;
    return {
      receiptNo: verified.receiptNo,
      amountMinor: verified.amountMinor,
      payerName:        typeof p.payer_name         === 'string' ? p.payer_name         : undefined,
      payerPhone:       typeof p.payer_phone        === 'string' ? p.payer_phone        : undefined,
      receiverName:     typeof p.credited_party_name === 'string' ? p.credited_party_name : undefined,
      transactionStatus: typeof p.transaction_status === 'string' ? p.transaction_status : undefined,
      date:             typeof p.date               === 'string' ? p.date               : undefined,
    };
  }

  async submitTelebirrReceipt(
    userId: string,
    dto: SubmitTelebirrReceiptDto
  ): Promise<TelebirrDepositResponse> {
    const submittedReceipt = dto.receiptNo ?? dto.receiptUrl;
    if (!submittedReceipt) {
      throw new ConflictException('receiptNo or receiptUrl is required');
    }

    const verified = await this.telebirrReceiptVerifierService.verifyReceipt(
      submittedReceipt,
      userId
    );

    // Enforce the admin-configured minimum deposit before crediting.
    await this.assertMeetsMinimum(verified.amountMinor);
    const depositCommissionPct = (await this.adminService.getSystemConfig()).depositCommissionPct ?? 0;

    let credited = false;
    const result = await this.dataSource.transaction(async (manager) => {
      const depositRepo = manager.getRepository(TelebirrDeposit);
      const existingDeposit = await depositRepo.findOneBy({ receiptNo: verified.receiptNo });

      if (existingDeposit) {
        if (existingDeposit.status === 'rejected') {
          throw new ConflictException('Telebirr receipt was already rejected');
        }
        if (existingDeposit.userId !== userId) {
          throw new ConflictException('Telebirr receipt was already used');
        }
        return this.toResponse(existingDeposit);
      }

      const deposit = depositRepo.create({
        userId,
        agentId: verified.agentId || undefined,
        receiptNo: verified.receiptNo,
        amountMinor: verified.amountMinor,
        currencyCode: 'CREDIT',
        status: 'credited',
        payerName: verified.parsedReceipt.payer_name,
        payerPhone: verified.parsedReceipt.payer_phone,
        creditedPartyName: verified.parsedReceipt.credited_party_name,
        creditedPartyAccount: verified.parsedReceipt.credited_party_acc_no,
        transactionStatus: verified.parsedReceipt.transaction_status,
        parsedReceipt: verified.parsedReceipt,
        verification: verified.verification
      });
      await depositRepo.save(deposit);

      const walletCredit = await this.walletService.creditInSession(
        {
          userId,
          amountMinor: verified.amountMinor,
          entryType: 'deposit',
          sourceType: 'telebirr_receipt',
          sourceId: verified.receiptNo,
          idempotencyKey: `telebirr:${verified.receiptNo}`,
          metadata: {
            receiptNo: verified.receiptNo,
            payerName: verified.parsedReceipt.payer_name,
            payerPhone: verified.parsedReceipt.payer_phone,
            transactionStatus: verified.parsedReceipt.transaction_status
          }
        },
        manager
      );

      deposit.walletCredit = walletCredit;
      await depositRepo.save(deposit);
      credited = true;

      if (deposit.agentId) {
        // First-deposit agent linking (Approach B): the agent who processed the
        // customer's FIRST credited deposit becomes their referring agent. Only set
        // when not already linked — first deposit wins, never reassigned.
        await manager
          .createQueryBuilder()
          .update(User)
          .set({ referredByAgentId: deposit.agentId })
          .where('id = :userId AND referredByAgentId IS NULL', { userId })
          .execute();

        const agentActionRepo = manager.getRepository(AgentActionLog);
        await agentActionRepo.save(
          agentActionRepo.create({
            agentId: deposit.agentId,
            userId,
            amountMinor: deposit.amountMinor,
            ledgerEntryId: walletCredit.ledgerEntry.id,
            actionType: 'telebirr_deposit_receipt',
            metadata: {
              receiptNo: deposit.receiptNo,
              payerPhone: deposit.payerPhone,
              creditedPartyAccount: deposit.creditedPartyAccount,
            },
          }),
        );

        await this.creditAgentDepositCommission(manager, {
          agentId: deposit.agentId,
          userId,
          provider: 'telebirr',
          reference: deposit.receiptNo,
          depositAmountMinor: deposit.amountMinor,
          depositCommissionPct,
        });
      }

      return this.toResponse(deposit);
    });

    // Post-commit, best-effort — only on a genuinely new credit (not a duplicate submit).
    if (credited) {
      await this.notificationsService.safeCreate({
        userId,
        type: 'deposit',
        title: 'Deposit received',
        body: `Your wallet was credited with ${result.amountMinor.toLocaleString()} ETB.`,
        data: { amountMinor: result.amountMinor, receiptNo: result.receiptNo },
      });
    }
    return result;
  }

  private toResponse(deposit: TelebirrDeposit): TelebirrDepositResponse {
    return {
      id: deposit.id,
      receiptNo: deposit.receiptNo,
      amountMinor: deposit.amountMinor,
      currencyCode: deposit.currencyCode,
      status: deposit.status,
      agentId: deposit.agentId,
      walletCredit: deposit.walletCredit || {},
      parsedReceipt: deposit.parsedReceipt,
      verification: deposit.verification || {}
    };
  }

  // ── M-PESA ─────────────────────────────────────────────────────────

  async previewMpesaSms(userId: string, dto: SubmitMpesaSmsDto): Promise<MpesaReceiptPreview> {
    const verified = await this.mpesaReceiptVerifierService.verifySms(dto.sms, userId);
    await this.assertMeetsMinimum(verified.amountMinor);
    const p = verified.parsedSms;
    return {
      confirmationCode: verified.confirmationCode,
      amountMinor: verified.amountMinor,
      receiverName: p.counterpartyName,
      receiverPhone: p.counterpartyPhone,
      date: p.dateRaw,
    };
  }

  async submitMpesaSms(userId: string, dto: SubmitMpesaSmsDto): Promise<MpesaDepositResponse> {
    const verified = await this.mpesaReceiptVerifierService.verifySms(dto.sms, userId);
    await this.assertMeetsMinimum(verified.amountMinor);
    const depositCommissionPct = (await this.adminService.getSystemConfig()).depositCommissionPct ?? 0;

    let credited = false;
    const result = await this.dataSource.transaction(async (manager) => {
      const depositRepo = manager.getRepository(MpesaDeposit);
      const existingDeposit = await depositRepo.findOneBy({ confirmationCode: verified.confirmationCode });

      if (existingDeposit) {
        if (existingDeposit.status === 'rejected') {
          throw new ConflictException('M-PESA receipt was already rejected');
        }
        if (existingDeposit.userId !== userId) {
          throw new ConflictException('M-PESA receipt was already used');
        }
        return this.toMpesaResponse(existingDeposit);
      }

      const deposit = depositRepo.create({
        userId,
        agentId: verified.agentId || undefined,
        confirmationCode: verified.confirmationCode,
        amountMinor: verified.amountMinor,
        currencyCode: 'CREDIT',
        status: 'credited',
        creditedPartyName: verified.parsedSms.counterpartyName,
        creditedPartyAccount: verified.parsedSms.counterpartyPhone,
        transactionStatus: verified.parsedSms.direction,
        parsedSms: verified.parsedSms,
        verification: verified.verification,
      });
      await depositRepo.save(deposit);

      const walletCredit = await this.walletService.creditInSession(
        {
          userId,
          amountMinor: verified.amountMinor,
          entryType: 'deposit',
          sourceType: 'mpesa_receipt',
          sourceId: verified.confirmationCode,
          idempotencyKey: `mpesa:${verified.confirmationCode}`,
          metadata: {
            confirmationCode: verified.confirmationCode,
            receiverName: verified.parsedSms.counterpartyName,
            receiverPhone: verified.parsedSms.counterpartyPhone,
          },
        },
        manager,
      );

      deposit.walletCredit = walletCredit;
      await depositRepo.save(deposit);
      credited = true;

      if (deposit.agentId) {
        // First-deposit agent linking — mirrors the Telebirr flow. First deposit
        // wins; never reassigned.
        await manager
          .createQueryBuilder()
          .update(User)
          .set({ referredByAgentId: deposit.agentId })
          .where('id = :userId AND referredByAgentId IS NULL', { userId })
          .execute();

        const agentActionRepo = manager.getRepository(AgentActionLog);
        await agentActionRepo.save(
          agentActionRepo.create({
            agentId: deposit.agentId,
            userId,
            amountMinor: deposit.amountMinor,
            ledgerEntryId: walletCredit.ledgerEntry.id,
            actionType: 'mpesa_deposit_receipt',
            metadata: {
              confirmationCode: deposit.confirmationCode,
              creditedPartyAccount: deposit.creditedPartyAccount,
            },
          }),
        );

        await this.creditAgentDepositCommission(manager, {
          agentId: deposit.agentId,
          userId,
          provider: 'mpesa',
          reference: deposit.confirmationCode,
          depositAmountMinor: deposit.amountMinor,
          depositCommissionPct,
        });
      }

      return this.toMpesaResponse(deposit);
    });

    if (credited) {
      await this.notificationsService.safeCreate({
        userId,
        type: 'deposit',
        title: 'Deposit received',
        body: `Your wallet was credited with ${result.amountMinor.toLocaleString()} ETB.`,
        data: { amountMinor: result.amountMinor, confirmationCode: result.confirmationCode },
      });
    }
    return result;
  }

  private toMpesaResponse(deposit: MpesaDeposit): MpesaDepositResponse {
    return {
      id: deposit.id,
      confirmationCode: deposit.confirmationCode,
      amountMinor: deposit.amountMinor,
      currencyCode: deposit.currencyCode,
      status: deposit.status,
      agentId: deposit.agentId,
      walletCredit: deposit.walletCredit || {},
      parsedSms: deposit.parsedSms,
      verification: deposit.verification || {},
    };
  }
}
