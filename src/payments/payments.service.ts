import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { AgentActionLog } from '../agents/entities/agent-action-log.entity';
import { SubmitTelebirrReceiptDto } from './dto/submit-telebirr-receipt.dto';
import { TelebirrDeposit } from './entities/telebirr-deposit.entity';
import { TelebirrReceiptVerifierService } from './telebirr-receipt-verifier.service';

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
    private readonly walletService: WalletService
  ) {}

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

    return await this.dataSource.transaction(async (manager) => {
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
