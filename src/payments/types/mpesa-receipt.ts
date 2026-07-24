/**
 * Structured fields from an M-PESA (Safaricom Ethiopia) receipt — the AUTHORITATIVE
 * source the confirmation SMS links to. The portal serves the receipt as a base64
 * PDF via GET /api/receipt/getReceipt?trxNo=<code>; its text layer carries the full,
 * UNMASKED transaction (the SMS masks the counterparty phone, the PDF does not).
 *
 * This is the M-PESA analogue of ParsedTelebirrReceipt.
 */
export type MpesaReceiptFields = {
  /** Transaction ID (the code that was queried). */
  code: string;
  amountBirr?: number;
  senderName?: string;
  /** Unmasked sender phone (the depositing player, or the paying agent). */
  senderPhone?: string;
  receiverName?: string;
  /** Unmasked receiver phone (the receiving agent, or the paid-out player). */
  receiverPhone?: string;
  /** Safaricom's internal receipt number (distinct from the transaction code). */
  receiptNo?: string;
  /** e.g. "Send Money", "Pay Merchant". */
  transactionType?: string;
  /** 'sent' | 'paid' | 'received' | 'purchase' | 'unknown', derived from the type. */
  direction?: 'sent' | 'paid' | 'received' | 'purchase' | 'unknown';
  /** Payment date as printed ("2026-07-24 11:53:57", EAT). */
  paymentDateRaw?: string;
  transactedAt?: Date;
};

/** The full portal result: the API envelope + the parsed PDF fields + raw evidence. */
export type ParsedMpesaReceipt = MpesaReceiptFields & {
  /** API responseCode; "0" means the transaction is real and successful. */
  responseCode: string;
  responseDescription?: string;
  success: boolean;
  /** The tag-stripped PDF text, kept as audit evidence. */
  text: string;
};
