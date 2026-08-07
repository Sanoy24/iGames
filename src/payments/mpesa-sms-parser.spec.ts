import { parseMpesaSms } from './mpesa-sms-parser';

describe('parseMpesaSms', () => {
    // The exact real sample provided by the operator  a bundle purchase.
    const REAL_BUNDLE_SMS =
        'Dear Yonas, you have bought a Safaricom bundle of 5.00 Birr for 251717404913 ' +
        'on 28/6/26 at 7:04 PM. Transaction number UFS98HOPQJ. Your current M-PESA balance is 37.00 Birr.';

    it('parses the real Safaricom Ethiopia format (Birr after amount, labelled code)', () => {
        const parsed = parseMpesaSms(REAL_BUNDLE_SMS)!;
        expect(parsed).not.toBeNull();
        expect(parsed.confirmationCode).toBe('UFS98HOPQJ');
        expect(parsed.amountBirr).toBe(5);
        expect(parsed.balanceBirr).toBe(37);
        expect(parsed.transactedAt).toBeInstanceOf(Date);
    });

    it('flags a bundle/airtime purchase as direction "purchase" (not a deposit)', () => {
        const parsed = parseMpesaSms(REAL_BUNDLE_SMS)!;
        expect(parsed.direction).toBe('purchase');
        expect(parsed.counterpartyPhone).toBe('251717404913');
    });

    it('converts the EAT timestamp to the correct UTC instant', () => {
        // 7:04 PM EAT (UTC+3) on 2026-06-28 → 16:04 UTC.
        const parsed = parseMpesaSms(REAL_BUNDLE_SMS)!;
        expect(parsed.transactedAt?.toISOString()).toBe(
            '2026-06-28T16:04:00.000Z',
        );
    });

    // The exact real send-to-person sample provided by the operator  masked phone,
    // "Transaction fee" line, and an appended "receipt here:" portal URL.
    const REAL_SEND_SMS =
        'Dear Yonas, you have sent 2.00 Birr to Tesfaye Adare Weldekidan 251714***707 ' +
        'on 24/7/26 at 11:53 AM. Transaction number UGO4D2CODA. Transaction fee 0.00 Birr. ' +
        'Your current  M-PESA balance is 10.00 Birr. ' +
        'Get your receipt here: https://m-pesabusiness.safaricom.et/receipt/UGO4D2CODA ' +
        'Get extra 20MB when you buy 100MB daily bundle via M-PESA for 5 birr.';

    it('parses the real masked send-to-person SMS (name and masked phone kept apart)', () => {
        const parsed = parseMpesaSms(REAL_SEND_SMS)!;
        expect(parsed).not.toBeNull();
        expect(parsed.direction).toBe('sent');
        expect(parsed.confirmationCode).toBe('UGO4D2CODA');
        expect(parsed.amountBirr).toBe(2);
        // The masked phone must NOT be swallowed into the name…
        expect(parsed.counterpartyName).toBe('Tesfaye Adare Weldekidan');
        // …and the mask must be preserved (not collapsed into wrong digits).
        expect(parsed.counterpartyPhone).toBe('251714***707');
        expect(parsed.balanceBirr).toBe(10);
        expect(parsed.receiptUrl).toBe(
            'https://m-pesabusiness.safaricom.et/receipt/UGO4D2CODA',
        );
        // 11:53 AM EAT (UTC+3) on 2026-07-24 → 08:53 UTC.
        expect(parsed.transactedAt?.toISOString()).toBe(
            '2026-07-24T08:53:00.000Z',
        );
    });

    it('does not mistake the "Transaction fee" figure for the amount', () => {
        const parsed = parseMpesaSms(REAL_SEND_SMS)!;
        expect(parsed.amountBirr).toBe(2);
    });

    it('parses a "transferred to <person>" send (the deposit case)', () => {
        const sms =
            'Dear Yonas, you have transferred 100.00 Birr to JANE DOE 251712345678 ' +
            'on 28/6/26 at 7:04 PM. Transaction number UFS98HOPQK. Your current M-PESA balance is 20.00 Birr.';
        const parsed = parseMpesaSms(sms)!;
        expect(parsed.direction).toBe('sent');
        expect(parsed.amountBirr).toBe(100);
        expect(parsed.counterpartyName).toBe('JANE DOE');
        expect(parsed.counterpartyPhone).toBe('251712345678');
    });

    it('parses a "sent to" send with a thousands-separated amount', () => {
        const sms =
            'Dear X, you have sent 1,250.00 Birr to AGENT SARA 251900000000 on 3/7/26 at 9:05 PM. ' +
            'Transaction number ABCD123456. Your current M-PESA balance is 5.00 Birr.';
        const parsed = parseMpesaSms(sms)!;
        expect(parsed.direction).toBe('sent');
        expect(parsed.amountBirr).toBe(1250);
        expect(parsed.counterpartyName).toBe('AGENT SARA');
    });

    it('parses a "paid to <merchant>" with no receiver phone', () => {
        const sms =
            'Dear X, you have paid 300.00 Birr to SOME SHOP on 3/7/26 at 9:05 PM. ' +
            'Transaction number ABCD123457. Your current M-PESA balance is 5.00 Birr.';
        const parsed = parseMpesaSms(sms)!;
        expect(parsed.direction).toBe('paid');
        expect(parsed.counterpartyName).toBe('SOME SHOP');
        expect(parsed.counterpartyPhone).toBeUndefined();
    });

    it('flags a "received from" message (wrong side for a deposit)', () => {
        const sms =
            'Dear X, you have received 100.00 Birr from JOHN DOE 251712345678 on 3/7/26 at 9:05 PM. ' +
            'Transaction number ABCD123458. Your current M-PESA balance is 105.00 Birr.';
        const parsed = parseMpesaSms(sms)!;
        expect(parsed.direction).toBe('received');
        expect(parsed.counterpartyName).toBe('JOHN DOE');
    });

    it('reads the confirmation code from the older "<CODE> Confirmed" style too', () => {
        // Some messages lead with the code before "Confirmed"  the verb grammar is
        // still Ethiopia-style (verb, then amount in Birr).
        const sms =
            'SGH7XYZ9Q2 Confirmed. You have sent 500.00 Birr to JANE DOE 251712345678 on 3/7/26 at 10:15 AM.';
        const parsed = parseMpesaSms(sms)!;
        expect(parsed.confirmationCode).toBe('SGH7XYZ9Q2');
        expect(parsed.amountBirr).toBe(500);
        expect(parsed.direction).toBe('sent');
    });

    it('returns null for text that is not an M-PESA confirmation', () => {
        expect(parseMpesaSms('Your OTP is 123456')).toBeNull();
        expect(parseMpesaSms('')).toBeNull();
    });

    it('tolerates extra whitespace and newlines', () => {
        const sms =
            '  Dear Yonas,\nyou have transferred 100.00 Birr to JANE DOE 251712345678\n' +
            'on 28/6/26 at 7:04 PM.  Transaction number   UFS98HOPQL.  ';
        const parsed = parseMpesaSms(sms)!;
        expect(parsed.confirmationCode).toBe('UFS98HOPQL');
        expect(parsed.counterpartyName).toBe('JANE DOE');
    });
});
