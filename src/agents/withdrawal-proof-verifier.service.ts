import { BadRequestException, Injectable } from '@nestjs/common';
import { TelebirrReceiptClientService } from '../payments/telebirr-receipt-client.service';
import { MpesaReceiptClientService } from '../payments/mpesa-receipt-client.service';
import { parseMpesaSms } from '../payments/mpesa-sms-parser';
import {
    accountMatchesPhone,
    checkFreshness,
    parseEatDate,
} from '../payments/receipt-verification';

export type PayoutProvider = 'telebirr' | 'mpesa';

export type VerifiedPayout = {
    provider: PayoutProvider;
    /** The receipt number / confirmation code  used as the dedupe key. */
    reference: string;
    amountMinor: number;
    receiverMatched: boolean | null;
    verification: Record<string, unknown>;
};

/**
 * Verifies an agent's proof that they actually paid a player their withdrawal,
 * BEFORE the player's frozen coins are released. Unlike the deposit verifiers
 * (where the credited party is the agent), here the receiver must be the PLAYER
 *  the withdrawal's destination account  and the payer is the agent. Checks:
 * receiver matches the player, amount matches the net payout, the transaction is
 * fresh, and (via the caller's dedupe) the reference hasn't been reused.
 */
@Injectable()
export class WithdrawalProofVerifierService {
    // Payouts can take a little longer than deposits (the agent pays out of band,
    // then submits the proof), so allow a more generous freshness window.
    private static readonly MAX_AGE_MS = 60 * 60 * 1000;

    constructor(
        private readonly telebirrClient: TelebirrReceiptClientService,
        private readonly mpesaClient: MpesaReceiptClientService,
    ) {}

    async verifyPayout(input: {
        provider: PayoutProvider;
        proof: string;
        destinationAccount: string;
        expectedAmountMinor: number;
        creditMinorPerBirr: number;
    }): Promise<VerifiedPayout> {
        if (input.provider === 'mpesa') {
            return this.verifyMpesa(input);
        }
        return this.verifyTelebirr(input);
    }

    private async verifyTelebirr(input: {
        proof: string;
        destinationAccount: string;
        expectedAmountMinor: number;
        creditMinorPerBirr: number;
    }): Promise<VerifiedPayout> {
        const parsed = await this.telebirrClient.fetchParsed(input.proof);

        const reference = parsed.receiptNo;
        if (!reference)
            throw new BadRequestException(
                'Telebirr receipt number was not found',
            );

        if (
            !this.telebirrClient.isAcceptedTransactionStatus(
                parsed.transaction_status,
            )
        ) {
            throw new BadRequestException(
                'Telebirr transaction is not completed',
            );
        }

        const amountBirr = parsed.settled_amount ?? parsed.total_amount;
        if (
            typeof amountBirr !== 'number' ||
            !Number.isFinite(amountBirr) ||
            amountBirr <= 0
        ) {
            throw new BadRequestException('Telebirr receipt amount is invalid');
        }
        const amountMinor = this.toMinor(amountBirr, input.creditMinorPerBirr);
        this.assertAmount(amountMinor, input.expectedAmountMinor);

        this.assertFresh(parseEatDate(parsed.date));

        // The receiver must be the PLAYER (the withdrawal destination).
        const receiverAccount = parsed.credited_party_acc_no;
        const receiverMatched = accountMatchesPhone(
            receiverAccount,
            input.destinationAccount,
        );
        if (receiverMatched === false) {
            throw new BadRequestException(
                'This Telebirr receipt was not paid to the player who requested the withdrawal',
            );
        }

        return {
            provider: 'telebirr',
            reference,
            amountMinor,
            receiverMatched,
            verification: {
                receiverAccount,
                creditedPartyName: parsed.credited_party_name,
                transactionStatus: parsed.transaction_status,
                date: parsed.date,
                receiverMatched,
            },
        };
    }

    private async verifyMpesa(input: {
        proof: string;
        destinationAccount: string;
        expectedAmountMinor: number;
        creditMinorPerBirr: number;
    }): Promise<VerifiedPayout> {
        const parsed = parseMpesaSms(input.proof);
        if (!parsed)
            throw new BadRequestException(
                'That does not look like an M-PESA confirmation SMS',
            );

        if (parsed.direction !== 'sent' && parsed.direction !== 'paid') {
            throw new BadRequestException(
                'Paste the "sent to <player>" M-PESA confirmation for the payout you made.',
            );
        }

        // When a portal is configured, verify against the AUTHORITATIVE receipt PDF
        // (unmasked receiver + settled amount) rather than the masked SMS.
        if (this.mpesaClient.isConfigured) {
            return this.verifyMpesaViaPortal(
                parsed.receiptUrl ?? parsed.confirmationCode,
                input,
            );
        }

        const amountMinor = this.toMinor(
            parsed.amountBirr,
            input.creditMinorPerBirr,
        );
        this.assertAmount(amountMinor, input.expectedAmountMinor);

        this.assertFresh(parsed.transactedAt ?? null);

        const receiverMatched = accountMatchesPhone(
            parsed.counterpartyPhone,
            input.destinationAccount,
        );
        if (receiverMatched === false) {
            throw new BadRequestException(
                'This M-PESA payment was not sent to the player who requested the withdrawal',
            );
        }
        // With M-PESA the receiver number is the only link to the player. If the SMS
        // didn't expose it, we can't prove the payout reached the right person.
        if (receiverMatched === null) {
            throw new BadRequestException(
                'The M-PESA SMS does not show the receiver number, so the payout cannot be matched to the player',
            );
        }

        return {
            provider: 'mpesa',
            reference: parsed.confirmationCode,
            amountMinor,
            receiverMatched,
            verification: {
                source: 'sms',
                receiverPhone: parsed.counterpartyPhone,
                receiverName: parsed.counterpartyName,
                direction: parsed.direction,
                date: parsed.dateRaw,
                receiverMatched,
            },
        };
    }

    /**
     * Verify an M-PESA payout against the authoritative portal receipt. The PDF is
     * unmasked, so the receiver phone is an exact link to the player. A "not found /
     * not successful" receipt or a portal outage BLOCKS the release (the admin manual
     * approve remains the override)  we never release a player's frozen coins on an
     * unconfirmable payout.
     */
    private async verifyMpesaViaPortal(
        codeOrUrl: string,
        input: {
            destinationAccount: string;
            expectedAmountMinor: number;
            creditMinorPerBirr: number;
        },
    ): Promise<VerifiedPayout> {
        const receipt = await this.mpesaClient.fetchParsed(codeOrUrl);

        if (receipt.amountBirr == null) {
            throw new BadRequestException(
                'The M-PESA receipt amount could not be read',
            );
        }
        const amountMinor = this.toMinor(
            receipt.amountBirr,
            input.creditMinorPerBirr,
        );
        this.assertAmount(amountMinor, input.expectedAmountMinor);

        this.assertFresh(receipt.transactedAt ?? null);

        const receiverMatched = accountMatchesPhone(
            receipt.receiverPhone,
            input.destinationAccount,
        );
        if (receiverMatched === false) {
            throw new BadRequestException(
                'This M-PESA payout was not sent to the player who requested the withdrawal',
            );
        }
        if (receiverMatched === null) {
            throw new BadRequestException(
                'The M-PESA receipt does not show a receiver number to match the player',
            );
        }

        return {
            provider: 'mpesa',
            reference: receipt.code,
            amountMinor,
            receiverMatched,
            verification: {
                source: 'portal',
                receiverPhone: receipt.receiverPhone,
                receiverName: receipt.receiverName,
                direction: receipt.direction,
                date: receipt.paymentDateRaw,
                success: receipt.success,
                receiverMatched,
            },
        };
    }

    private toMinor(amountBirr: number, creditMinorPerBirr: number): number {
        const multiplier = creditMinorPerBirr || 1;
        const minor = Math.round(amountBirr * multiplier);
        if (!Number.isSafeInteger(minor) || minor <= 0) {
            throw new BadRequestException('Payout amount is invalid');
        }
        return minor;
    }

    private assertAmount(actualMinor: number, expectedMinor: number): void {
        if (actualMinor !== expectedMinor) {
            throw new BadRequestException(
                `The payout proof is for ${actualMinor.toLocaleString()} ETB but the player is owed ` +
                    `${expectedMinor.toLocaleString()} ETB. Pay the exact amount and resubmit.`,
            );
        }
    }

    private assertFresh(txDate: Date | null): void {
        if (!txDate) {
            throw new BadRequestException(
                'The payout proof is missing a readable transaction time',
            );
        }
        const verdict = checkFreshness(
            txDate,
            new Date(),
            WithdrawalProofVerifierService.MAX_AGE_MS,
        );
        if (verdict === 'too_old') {
            throw new BadRequestException(
                'The payout transaction is too old (exceeds 60 minutes)',
            );
        }
        if (verdict === 'future') {
            throw new BadRequestException(
                'The payout transaction time is in the future',
            );
        }
    }
}
