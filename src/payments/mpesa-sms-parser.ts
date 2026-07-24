import { parseEatDate } from './receipt-verification';

/**
 * Structured fields extracted from a Safaricom Ethiopia M-PESA confirmation SMS.
 * `direction` says what kind of transaction it was:
 *   • 'sent'      → money transferred to a person (a player depositing to an agent),
 *   • 'paid'      → money paid to a merchant/till,
 *   • 'received'  → money arrived (the agent's copy — wrong side for a deposit),
 *   • 'purchase'  → airtime/bundle bought (NOT a deposit),
 *   • 'unknown'   → recognised a code + amount but not the flow.
 * For a player deposit we expect 'sent' (or 'paid'), and `counterparty*` is the
 * agent who received the money.
 *
 * Real sample this parser is calibrated against (a bundle purchase):
 *   "Dear Yonas, you have bought a Safaricom bundle of 5.00 Birr for 251717404913
 *    on 28/6/26 at 7:04 PM. Transaction number UFS98HOPQJ. Your current M-PESA
 *    balance is 37.00 Birr."
 * Key format facts: amount is "<n> Birr" (currency AFTER), the code is labelled
 * "Transaction number <CODE>." near the end, and there is no "Confirmed" keyword.
 */
export type ParsedMpesaSms = {
  confirmationCode: string;
  amountBirr: number;
  direction: 'sent' | 'paid' | 'received' | 'purchase' | 'unknown';
  counterpartyName?: string;
  counterpartyPhone?: string;
  dateRaw?: string;
  transactedAt?: Date;
  balanceBirr?: number;
  raw: string;
};

// An amount, tolerant of either currency style: "5.00 Birr" (Ethiopia format)
// or "ETB 5.00" (older assumption). Capture group 1 is the numeric amount.
const AMOUNT = String.raw`(?:ETB\s*)?([\d,]+\.\d{2})(?:\s*Birr)?`;
// A phone number: 8+ digits, optional leading + and internal spaces.
const PHONE = String.raw`(\+?\d[\d\s]{7,}\d)`;

/** Strip thousands separators from an "1,234.56" amount and return a number. */
function toAmount(value: string): number {
  return Number(value.replace(/,/g, ''));
}

/**
 * Parse an M-PESA confirmation SMS. Tolerant of wording and spacing differences
 * because operators reformat these over time. Returns null when the text is not a
 * recognisable M-PESA confirmation.
 *
 * NOTE: the transaction VERBS ("transferred/sent to", "paid to", "received
 * from", "bought … for") are the part most likely to drift. They live in the
 * regexes below and are covered by `mpesa-sms-parser.spec.ts` — the single place
 * to re-tune against a fresh real sample.
 */
export function parseMpesaSms(input: string): ParsedMpesaSms | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  // Normalise unicode spaces/newlines to plain spaces for regex simplicity.
  const text = raw.replace(/\s+/g, ' ');

  // Confirmation code. Ethiopia format labels it "Transaction number <CODE>";
  // fall back to the older "<CODE> Confirmed" leading-token style.
  const codeMatch =
    text.match(/Transaction\s+(?:number|no\.?|id)\s*:?\s*([A-Za-z0-9]{8,14})/i) ||
    text.match(/\b([A-Z0-9]{8,12})\b\s+Confirmed/i);
  if (!codeMatch) return null;
  const confirmationCode = codeMatch[1].toUpperCase();

  let amountBirr = NaN;
  let direction: ParsedMpesaSms['direction'] = 'unknown';
  let counterpartyName: string | undefined;
  let counterpartyPhone: string | undefined;

  // Order matters: check purchase (bundle/airtime) before the generic verbs so a
  // "bought … for <phone>" isn't misread, and check "received" before "sent".
  const purchaseMatch = text.match(
    new RegExp(String.raw`bought\s+.*?\bof\s+${AMOUNT}\s+for\s+${PHONE}\s+on\b`, 'i'),
  );
  const receivedMatch = text.match(
    new RegExp(String.raw`received\s+${AMOUNT}\s+from\s+(.+?)(?:\s+${PHONE})?\s+on\b`, 'i'),
  );
  const sentMatch = text.match(
    new RegExp(String.raw`(transferred|sent|paid)\s+${AMOUNT}\s+to\s+(.+?)(?:\s+${PHONE})?\s+on\b`, 'i'),
  );

  if (purchaseMatch) {
    amountBirr = toAmount(purchaseMatch[1]);
    direction = 'purchase';
    counterpartyPhone = cleanPhone(purchaseMatch[2]);
  } else if (receivedMatch) {
    amountBirr = toAmount(receivedMatch[1]);
    direction = 'received';
    counterpartyName = cleanName(receivedMatch[2]);
    counterpartyPhone = cleanPhone(receivedMatch[3]);
  } else if (sentMatch) {
    amountBirr = toAmount(sentMatch[2]);
    direction = sentMatch[1].toLowerCase() === 'paid' ? 'paid' : 'sent';
    counterpartyName = cleanName(sentMatch[3]);
    counterpartyPhone = cleanPhone(sentMatch[4]);
  } else {
    // Last resort: a bare amount so at least the code + amount survive. Avoid the
    // balance figure by preferring one that isn't immediately after "balance is".
    const amounts = [...text.matchAll(new RegExp(AMOUNT, 'gi'))];
    const nonBalance = amounts.find((m) => !/balance\s+is\s*$/i.test(text.slice(0, m.index)));
    if (nonBalance) amountBirr = toAmount(nonBalance[1]);
  }

  if (!Number.isFinite(amountBirr) || amountBirr <= 0) return null;

  // Date + time: "on 28/6/26 at 7:04 PM" (time optional).
  const dateMatch = text.match(
    /on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp][Mm]?))?/,
  );
  const dateRaw = dateMatch ? [dateMatch[1], dateMatch[2]].filter(Boolean).join(' ') : undefined;
  const transactedAt = parseEatDate(dateRaw) ?? undefined;

  // New balance, if present — informational only.
  const balanceMatch = text.match(new RegExp(String.raw`balance\s+is\s+${AMOUNT}`, 'i'));
  const balanceBirr = balanceMatch ? toAmount(balanceMatch[1]) : undefined;

  return {
    confirmationCode,
    amountBirr,
    direction,
    counterpartyName,
    counterpartyPhone,
    dateRaw,
    transactedAt,
    balanceBirr,
    raw,
  };
}

/** Tidy a captured name: collapse spaces, drop a trailing period, trim. */
function cleanName(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, ' ').replace(/\.\s*$/, '').trim();
  return cleaned || undefined;
}

/** Keep only the digits of a captured phone number. */
function cleanPhone(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 8 ? digits : undefined;
}
