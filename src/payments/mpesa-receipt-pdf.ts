import { parseEatDate } from './receipt-verification';
import { MpesaReceiptFields } from './types/mpesa-receipt';

/**
 * Parse the TEXT LAYER of an M-PESA receipt PDF (as produced by pdf-parse) into
 * structured fields. Pure and DB-free so it can be unit-tested against a real
 * fixture — the M-PESA analogue of telebirr-receipt's parseFromHTML.
 *
 * The PDF is a fixed government-style receipt template (TIN/VAT header, bilingual
 * EN/AM labels). pdf-parse emits the text in PDF-layout order (not reading order),
 * so we anchor on the stable ENGLISH labels ("/ SENDER NAME", "/ TRANSACTION ID",
 * …) and on unambiguous token shapes (12-digit 251… phones, the ISO payment date
 * immediately followed by the settled amount). Calibrated against the real receipt
 * for UGO4D2CODA (see __fixtures__/mpesa-receipt-UGO4D2CODA.txt).
 *
 * `code` is the queried transaction id; it is trusted as the code but `direction`
 * and the amount/receiver come from the PDF so a forged input cannot fake them.
 */
export function parseMpesaReceiptText(text: string, code: string): MpesaReceiptFields {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Value printed on the next usable line after an English "/ LABEL" line.
  const valueAfter = (label: string): string | undefined => {
    const i = lines.findIndex((l) => normalizeLabel(l) === normalizeLabel(label));
    if (i === -1) return undefined;
    for (let j = i + 1; j < lines.length; j++) {
      const v = lines[j];
      if (v.startsWith('/') || !/[A-Za-z0-9]/.test(v)) continue; // skip labels / Amharic-only
      return v;
    }
    return undefined;
  };

  // All unmasked local phones (12-digit 251XXXXXXXXX). Safaricom's own "+251 756
  // 765434" support line has internal spaces, so \d{9} after 251 never matches it.
  const phones = [...text.matchAll(/\b(251\d{9})\b/g)].map((m) => m[1]);

  const senderNameRaw = valueAfter('/ SENDER NAME');
  const receiverNameRaw = valueAfter('/ RECEIVER NAME');
  const senderPhoneLabelled = valueAfter('/ SENDER PHONE NUMBER');

  // Sender = the labelled sender phone when it is a real 251 number; receiver = the
  // other 251 number on the receipt.
  const senderPhone = phones.find((p) => p === senderPhoneLabelled) ?? undefined;
  const receiverPhone = phones.find((p) => p !== senderPhone) ?? undefined;

  // Payment date + settled amount are printed adjacently: "…<date><amount>", e.g.
  // "SCOAD3UVREUH2026-07-24 11:53:572.00" (receiptNo, date, amount concatenated).
  const dateAmount = text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\s*(\d+(?:\.\d{2}))/);
  const paymentDateRaw = dateAmount?.[1];
  const amountBirr = dateAmount ? toAmount(dateAmount[2]) : extractLooseAmount(text);
  const transactedAt = parseEatDate(paymentDateRaw) ?? undefined;

  // Receipt number: the letter-led token immediately before the payment date.
  const receiptNo = text.match(/([A-Z][A-Z0-9]{9,13})(?=\d{4}-\d{2}-\d{2})/)?.[1];

  const transactionType = extractType(text);
  const direction = directionFromType(transactionType);

  return {
    code: code.toUpperCase(),
    amountBirr: Number.isFinite(amountBirr) && (amountBirr ?? 0) > 0 ? amountBirr : undefined,
    senderName: cleanName(senderNameRaw),
    senderPhone,
    receiverName: cleanName(receiverNameRaw),
    receiverPhone,
    receiptNo,
    transactionType,
    direction,
    paymentDateRaw,
    transactedAt,
  };
}

function normalizeLabel(s: string): string {
  return s.replace(/^\s*\/\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function toAmount(value: string): number {
  return Number(value.replace(/,/g, ''));
}

/** Fallback: a bare "<n>.<dd>" figure near a "SETTLED AMOUNT"/"TOTAL" word. */
function extractLooseAmount(text: string): number | undefined {
  const m = text.match(/([\d,]+\.\d{2})\s*(?:Birr)?/i);
  return m ? toAmount(m[1]) : undefined;
}

function extractType(text: string): string | undefined {
  const m = text.match(/\b(send money|pay merchant|buy goods(?:\s*&?\s*services)?|withdraw(?:al)?|pay bill|airtime|bank transfer)\b/i);
  return m ? m[1].replace(/\s+/g, ' ') : undefined;
}

function directionFromType(type?: string): MpesaReceiptFields['direction'] {
  if (!type) return 'unknown';
  const t = type.toLowerCase();
  if (t.includes('airtime')) return 'purchase';
  if (t.includes('send money') || t.includes('bank transfer')) return 'sent';
  if (t.includes('pay') || t.includes('buy') || t.includes('bill')) return 'paid';
  if (t.includes('withdraw')) return 'sent';
  return 'unknown';
}

function cleanName(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, ' ').replace(/[.\-]+$/, '').trim();
  return cleaned.length >= 2 && /[A-Za-z]/.test(cleaned) ? cleaned : undefined;
}
