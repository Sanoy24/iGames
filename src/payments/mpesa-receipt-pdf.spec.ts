import { readFileSync } from 'fs';
import { join } from 'path';
import { parseMpesaReceiptText } from './mpesa-receipt-pdf';

// Real pdf-parse output of the authoritative receipt PDF for transaction
// UGO4D2CODA (GET /api/receipt/getReceipt?trxNo=UGO4D2CODA → base64 PDF → pdf-parse).
const REAL_TEXT = readFileSync(
  join(__dirname, '__fixtures__', 'mpesa-receipt-UGO4D2CODA.txt'),
  'utf8',
);

describe('parseMpesaReceiptText (real receipt fixture)', () => {
  const parsed = parseMpesaReceiptText(REAL_TEXT, 'UGO4D2CODA');

  it('extracts the settled amount', () => {
    expect(parsed.amountBirr).toBe(2);
  });

  it('extracts the UNMASKED sender and receiver phones', () => {
    expect(parsed.senderPhone).toBe('251717404913');
    expect(parsed.receiverPhone).toBe('251714267707'); // SMS masked this as 251714***707
  });

  it('extracts the sender and receiver names', () => {
    expect(parsed.senderName).toBe('Yonas Mekonnen Eshete');
    expect(parsed.receiverName).toBe('Tesfaye Adare Weldekidan');
  });

  it('extracts the transaction type and direction', () => {
    expect(parsed.transactionType?.toLowerCase()).toBe('send money');
    expect(parsed.direction).toBe('sent');
  });

  it('extracts the receipt number (distinct from the transaction code)', () => {
    expect(parsed.receiptNo).toBe('SCOAD3UVREUH');
    expect(parsed.code).toBe('UGO4D2CODA');
  });

  it('parses the EAT payment date to the correct UTC instant', () => {
    // 2026-07-24 11:53:57 EAT (UTC+3) → 08:53:57 UTC.
    expect(parsed.paymentDateRaw).toBe('2026-07-24 11:53:57');
    expect(parsed.transactedAt?.toISOString()).toBe('2026-07-24T08:53:57.000Z');
  });

  it('keeps sender and receiver phones distinct', () => {
    expect(parsed.senderPhone).not.toBe(parsed.receiverPhone);
  });
});
