import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelebirrReceiptVerifierService } from './telebirr-receipt-verifier.service';

describe('TelebirrReceiptVerifierService', () => {
  let service: TelebirrReceiptVerifierService;

  beforeEach(() => {
    service = new TelebirrReceiptVerifierService({
      get: (key: string) => {
        if (key === 'TELEBIRR_EXPECTED_RECEIVER_NAME') {
          return 'iGames Wallet';
        }
        if (key === 'TELEBIRR_EXPECTED_RECEIVER_ACCOUNT') {
          return '0911223344';
        }
        return undefined;
      },
      getOrThrow: (key: string) => {
        if (key === 'TELEBIRR_CREDIT_MINOR_PER_BIRR') {
          return 100;
        }
        throw new Error(`Unexpected config key: ${key}`);
      }
    } as ConfigService);
  });

  it('verifies completed receipts for the configured receiver', () => {
    const result = service.verifyParsedReceipt('ADQ123', {
      receiptNo: 'ADQ123',
      settled_amount: 250,
      transaction_status: 'Completed',
      credited_party_name: 'iGames Wallet',
      credited_party_acc_no: '0911223344',
      payer_name: 'Jane Player'
    });

    expect(result.receiptNo).toBe('ADQ123');
    expect(result.amountMinor).toBe(25000);
    expect(result.verification.receiverNameMatched).toBe(true);
    expect(result.verification.receiverAccountMatched).toBe(true);
  });

  it('rejects receipts for another receiver', () => {
    expect(() =>
      service.verifyParsedReceipt('ADQ123', {
        receiptNo: 'ADQ123',
        settled_amount: 250,
        transaction_status: 'Completed',
        credited_party_name: 'Someone Else',
        credited_party_acc_no: '0911223344'
      })
    ).toThrow(BadRequestException);
  });

  it('rejects incomplete transactions', () => {
    expect(() =>
      service.verifyParsedReceipt('ADQ123', {
        receiptNo: 'ADQ123',
        settled_amount: 250,
        transaction_status: 'Pending',
        credited_party_name: 'iGames Wallet',
        credited_party_acc_no: '0911223344'
      })
    ).toThrow(BadRequestException);
  });
});
