export type ParsedTelebirrReceipt = {
  payer_name?: string;
  payer_phone?: string;
  payer_acc_type?: string;
  credited_party_name?: string;
  credited_party_acc_no?: string;
  transaction_status?: string;
  bank_acc_no?: string;
  to?: string;
  receiptNo?: string;
  date?: string;
  settled_amount?: number;
  discount_amount?: number;
  vat_amount?: number;
  total_amount?: number;
  amount_in_word?: string;
  payment_mode?: string;
  payment_reason?: string;
  payment_channel?: string;
};

export type TelebirrReceiptPackage = {
  receipt: (
    parsedFields: ParsedTelebirrReceipt,
    preDefinedFields?: Partial<ParsedTelebirrReceipt>
  ) => {
    equals: (a: string | number | undefined, b: string | number | undefined) => boolean;
    verify: (
      callback: (
        parsedFields: ParsedTelebirrReceipt,
        preDefinedFields: Partial<ParsedTelebirrReceipt>
      ) => boolean
    ) => boolean;
    verifyOnly: (fieldNames?: string[]) => boolean;
    verifyAll: (doNotCompare?: string[]) => boolean;
  };
  utils: {
    loadReceipt: (input: {
      receiptNo?: string;
      fullUrl?: string;
    }) => Promise<string>;
    parseFromHTML: (html: string) => ParsedTelebirrReceipt;
  };
};
