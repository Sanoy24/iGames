import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminService } from '../admin/admin.service';
import { AgentActionLog } from '../agents/entities/agent-action-log.entity';
import { SubmitTelebirrReceiptDto } from './dto/submit-telebirr-receipt.dto';
import { TelebirrDeposit } from './entities/telebirr-deposit.entity';
import { TelebirrReceiptVerifierService } from './telebirr-receipt-verifier.service';

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

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TelebirrDeposit)
    private readonly telebirrDepositRepository: Repository<TelebirrDeposit>,
    private readonly telebirrReceiptVerifierService: TelebirrReceiptVerifierService,
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
}
