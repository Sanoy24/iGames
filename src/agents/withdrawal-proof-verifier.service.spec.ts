import { BadRequestException } from '@nestjs/common';
import { TelebirrReceiptClientService } from '../payments/telebirr-receipt-client.service';
import { WithdrawalProofVerifierService } from './withdrawal-proof-verifier.service';

// A fresh EAT timestamp string the freshness check will accept.
function freshTelebirrDate(): string {
  const d = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago (UTC)
  // Telebirr prints EAT (UTC+3) as DD-MM-YYYY HH:mm:ss.
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(eat.getUTCDate())}-${p(eat.getUTCMonth() + 1)}-${eat.getUTCFullYear()} ${p(eat.getUTCHours())}:${p(eat.getUTCMinutes())}:${p(eat.getUTCSeconds())}`;
}

function freshMpesaDateParts(): string {
  const d = new Date(Date.now() - 5 * 60 * 1000);
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const hours = eat.getUTCHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${eat.getUTCDate()}/${eat.getUTCMonth() + 1}/${String(eat.getUTCFullYear()).slice(-2)} at ${h12}:${p(eat.getUTCMinutes())} ${ampm}`;
}

function makeService(parsedReceipt?: Record<string, unknown>) {
  const client = {
    fetchParsed: jest.fn().mockResolvedValue(parsedReceipt ?? {}),
    isAcceptedTransactionStatus: (s?: string) =>
      !!s && ['completed', 'success', 'paid'].some((a) => s.toLowerCase().includes(a)),
  } as unknown as TelebirrReceiptClientService;
  return new WithdrawalProofVerifierService(client);
}

describe('WithdrawalProofVerifierService — Telebirr', () => {
  const base = {
    provider: 'telebirr' as const,
    proof: 'ADQ123456',
    destinationAccount: '0712345678',
    expectedAmountMinor: 100,
    creditMinorPerBirr: 1,
  };

  it('accepts a receipt paid to the player for the exact net amount', async () => {
    const svc = makeService({
      receiptNo: 'ADQ123456',
      transaction_status: 'Completed',
      settled_amount: 100,
      credited_party_acc_no: '251712345678',
      credited_party_name: 'PLAYER ONE',
      date: freshTelebirrDate(),
    });
    const result = await svc.verifyPayout(base);
    expect(result.reference).toBe('ADQ123456');
    expect(result.amountMinor).toBe(100);
    expect(result.receiverMatched).toBe(true);
  });

  it('rejects when the amount does not match the net payout', async () => {
    const svc = makeService({
      receiptNo: 'ADQ123456',
      transaction_status: 'Completed',
      settled_amount: 90,
      credited_party_acc_no: '251712345678',
      date: freshTelebirrDate(),
    });
    await expect(svc.verifyPayout(base)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the receiver is a different phone than the player', async () => {
    const svc = makeService({
      receiptNo: 'ADQ123456',
      transaction_status: 'Completed',
      settled_amount: 100,
      credited_party_acc_no: '251799999999',
      date: freshTelebirrDate(),
    });
    await expect(svc.verifyPayout(base)).rejects.toThrow(/not paid to the player/i);
  });

  it('rejects a stale receipt', async () => {
    const svc = makeService({
      receiptNo: 'ADQ123456',
      transaction_status: 'Completed',
      settled_amount: 100,
      credited_party_acc_no: '251712345678',
      date: '01-01-2020 10:00:00',
    });
    await expect(svc.verifyPayout(base)).rejects.toThrow(/too old/i);
  });

  it('rejects an incomplete transaction status', async () => {
    const svc = makeService({
      receiptNo: 'ADQ123456',
      transaction_status: 'Pending',
      settled_amount: 100,
      credited_party_acc_no: '251712345678',
      date: freshTelebirrDate(),
    });
    await expect(svc.verifyPayout(base)).rejects.toThrow(/not completed/i);
  });
});

describe('WithdrawalProofVerifierService — M-PESA', () => {
  const svc = makeService();
  const destinationAccount = '0712345678';

  it('accepts a "sent to player" SMS for the exact amount', async () => {
    const sms =
      `Dear Agent, you have sent 100.00 Birr to PLAYER ONE 251712345678 on ${freshMpesaDateParts()}. ` +
      `Transaction number MPX12345AB. Your current M-PESA balance is 5.00 Birr.`;
    const result = await svc.verifyPayout({
      provider: 'mpesa',
      proof: sms,
      destinationAccount,
      expectedAmountMinor: 100,
      creditMinorPerBirr: 1,
    });
    expect(result.provider).toBe('mpesa');
    expect(result.reference).toBe('MPX12345AB');
    expect(result.receiverMatched).toBe(true);
  });

  it('accepts the real masked send format (251714***707) when the ends match the player', async () => {
    const sms =
      `Dear Agent, you have sent 100.00 Birr to PLAYER ONE 251712***678 on ${freshMpesaDateParts()}. ` +
      `Transaction number MPX12345AF. Transaction fee 0.00 Birr. Your current M-PESA balance is 5.00 Birr.`;
    const result = await svc.verifyPayout({
      provider: 'mpesa',
      proof: sms,
      destinationAccount: '0712345678',
      expectedAmountMinor: 100,
      creditMinorPerBirr: 1,
    });
    expect(result.receiverMatched).toBe(true);
    expect(result.reference).toBe('MPX12345AF');
  });

  it('rejects a masked send whose visible ends do not match the player', async () => {
    const sms =
      `Dear Agent, you have sent 100.00 Birr to SOMEONE 251799***678 on ${freshMpesaDateParts()}. ` +
      `Transaction number MPX12345AG. Your current M-PESA balance is 5.00 Birr.`;
    await expect(
      svc.verifyPayout({ provider: 'mpesa', proof: sms, destinationAccount: '0712345678', expectedAmountMinor: 100, creditMinorPerBirr: 1 }),
    ).rejects.toThrow(/not sent to the player/i);
  });

  it('rejects when the SMS has no receiver number to match the player', async () => {
    const sms =
      `Dear Agent, you have paid 100.00 Birr to SOME SHOP on ${freshMpesaDateParts()}. ` +
      `Transaction number MPX12345AC. Your current M-PESA balance is 5.00 Birr.`;
    await expect(
      svc.verifyPayout({ provider: 'mpesa', proof: sms, destinationAccount, expectedAmountMinor: 100, creditMinorPerBirr: 1 }),
    ).rejects.toThrow(/does not show the receiver number/i);
  });

  it('rejects a "received" SMS (wrong direction for a payout)', async () => {
    const sms =
      `Dear Agent, you have received 100.00 Birr from PLAYER ONE 251712345678 on ${freshMpesaDateParts()}. ` +
      `Transaction number MPX12345AD. Your current M-PESA balance is 105.00 Birr.`;
    await expect(
      svc.verifyPayout({ provider: 'mpesa', proof: sms, destinationAccount, expectedAmountMinor: 100, creditMinorPerBirr: 1 }),
    ).rejects.toThrow(/sent to/i);
  });

  it('rejects when the amount is wrong', async () => {
    const sms =
      `Dear Agent, you have sent 50.00 Birr to PLAYER ONE 251712345678 on ${freshMpesaDateParts()}. ` +
      `Transaction number MPX12345AE. Your current M-PESA balance is 5.00 Birr.`;
    await expect(
      svc.verifyPayout({ provider: 'mpesa', proof: sms, destinationAccount, expectedAmountMinor: 100, creditMinorPerBirr: 1 }),
    ).rejects.toThrow(/is owed/i);
  });
});
