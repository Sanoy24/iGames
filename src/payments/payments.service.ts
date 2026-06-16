import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { WalletService } from '../wallet/wallet.service';
import { SubmitTelebirrReceiptDto } from './dto/submit-telebirr-receipt.dto';
import {
  TelebirrDeposit,
  TelebirrDepositDocument
} from './schemas/telebirr-deposit.schema';
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
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(TelebirrDeposit.name)
    private readonly telebirrDepositModel: Model<TelebirrDeposit>,
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
    const objectUserId = new Types.ObjectId(userId);
    const session = await this.connection.startSession();

    try {
      let response: TelebirrDepositResponse | undefined;

      await session.withTransaction(async () => {
        const existingDeposit = await this.telebirrDepositModel
          .findOne({ receiptNo: verified.receiptNo })
          .session(session)
          .exec();

        if (existingDeposit) {
          if (existingDeposit.status === 'rejected') {
            throw new ConflictException('Telebirr receipt was already rejected');
          }
          if (existingDeposit.userId.toString() !== userId) {
            throw new ConflictException('Telebirr receipt was already used');
          }
          response = this.toResponse(existingDeposit);
          return;
        }

        const [deposit] = await this.telebirrDepositModel.create(
          [
            {
              userId: objectUserId,
              agentId: verified.agentId ? new Types.ObjectId(verified.agentId) : undefined,
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
            }
          ],
          { session }
        );

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
          session
        );

        deposit.walletCredit = walletCredit;
        await deposit.save({ session });

        response = this.toResponse(deposit);
      });

      if (!response) {
        throw new Error('Telebirr deposit transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  private toResponse(deposit: TelebirrDepositDocument): TelebirrDepositResponse {
    return {
      id: deposit._id.toString(),
      receiptNo: deposit.receiptNo,
      amountMinor: deposit.amountMinor,
      currencyCode: deposit.currencyCode,
      status: deposit.status,
      agentId: deposit.agentId?.toString(),
      walletCredit: deposit.walletCredit,
      parsedReceipt: deposit.parsedReceipt,
      verification: deposit.verification
    };
  }
}
