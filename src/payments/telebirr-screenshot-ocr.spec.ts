import { extractTelebirrTxnNumber } from './telebirr-screenshot-ocr';

describe('extractTelebirrTxnNumber', () => {
  it('extracts the code from clean OCR text matching the real "Successful" screen layout', () => {
    const ocrText = [
      'Successful',
      '-310.00 (ETB)',
      'Transaction Time: 2026/08/01 20:17:36',
      'Transaction Type: Buy Goods',
      'Transaction To: BENATI TRADING PLC',
      'Transaction Number: DH11G2Q7VJ',
      'Give Tip   QR Code',
    ].join('\n');
    expect(extractTelebirrTxnNumber(ocrText)).toBe('DH11G2Q7VJ');
  });

  it('is case-insensitive on the label and normalizes the code to uppercase', () => {
    const ocrText = 'transaction number: dh11g2q7vj';
    expect(extractTelebirrTxnNumber(ocrText)).toBe('DH11G2Q7VJ');
  });

  it('handles "Transaction No" and missing colon variants', () => {
    expect(extractTelebirrTxnNumber('Transaction No DH11G2Q7VJ')).toBe('DH11G2Q7VJ');
    expect(extractTelebirrTxnNumber('Transaction # DH11G2Q7VJ')).toBe('DH11G2Q7VJ');
  });

  it('falls back to the next line when OCR splits the label from its value', () => {
    const ocrText = 'Transaction Number:\nsome noise\nDH11G2Q7VJ';
    expect(extractTelebirrTxnNumber(ocrText)).toBe('DH11G2Q7VJ');
  });

  it('falls back to shape-scanning the whole text when no label is present', () => {
    const ocrText = 'Some garbled header\n-310.00 (ETB)\nDH11G2Q7VJ\nGive Tip';
    expect(extractTelebirrTxnNumber(ocrText)).toBe('DH11G2Q7VJ');
  });

  it('does not false-positive on short unrelated all-caps text (e.g. an ad banner)', () => {
    const ocrText = 'We will see Football on SuperSport\nDSTV monthly mobile data';
    expect(extractTelebirrTxnNumber(ocrText)).toBeNull();
  });

  it('returns null for empty or unrelated text', () => {
    expect(extractTelebirrTxnNumber('')).toBeNull();
    expect(extractTelebirrTxnNumber(null)).toBeNull();
    expect(extractTelebirrTxnNumber('just some random text with no code')).toBeNull();
  });
});
