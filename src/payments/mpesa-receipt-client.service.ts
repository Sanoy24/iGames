import {
    BadRequestException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';
import { parseMpesaReceiptText } from './mpesa-receipt-pdf';
import { ParsedMpesaReceipt } from './types/mpesa-receipt';

// pdf-parse is CommonJS; require the lib entry directly to skip its debug harness
// (the package index reads a sample PDF when it thinks it has no parent module).
const loadCommonJsModule = createRequire(__filename);
type PdfParse = (data: Buffer) => Promise<{ text: string }>;
const pdfParse = loadCommonJsModule('pdf-parse/lib/pdf-parse.js') as PdfParse;

/** The only host we will fetch an M-PESA receipt from directly. */
const MPESA_RECEIPT_HOST = 'm-pesabusiness.safaricom.et';
/** The portal's receipt data endpoint (returns a base64 PDF envelope). */
const RECEIPT_API_PATH = '/api/receipt/getReceipt';

type ReceiptApiResponse = {
    responseCode?: string;
    responseDescription?: string;
    base64Data?: string;
};

/**
 * M-PESA (Safaricom Ethiopia) receipt fetch+parse client  the analogue of
 * TelebirrReceiptClientService. It fetches the AUTHORITATIVE receipt the SMS links
 * to: the portal serves it as a base64 PDF via
 *   GET https://m-pesabusiness.safaricom.et/api/receipt/getReceipt?trxNo=<code>
 * returning { responseCode, responseDescription, base64Data }. responseCode "0"
 * means the transaction is real and successful; the PDF's text layer carries the
 * full, UNMASKED transaction (sender/receiver name + phone, amount, date, type).
 *
 * Kept as its own leaf (ConfigService-only) service so BOTH the deposit verifier
 * (PaymentsModule) and the withdrawal-proof verifier (AgentsModule) can use it
 * without an import cycle. When MPESA_PORTAL_URL is set the request goes through
 * that egress proxy (for hosts that cannot reach Safaricom directly); otherwise it
 * fetches the portal API directly.
 */
@Injectable()
export class MpesaReceiptClientService {
    private readonly logger = new Logger(MpesaReceiptClientService.name);

    constructor(private readonly configService: ConfigService) {}

    /** Master switch for the authoritative portal cross-check (MPESA_PORTAL_ENABLED). */
    get isConfigured(): boolean {
        return this.configService.get<boolean>('MPESA_PORTAL_ENABLED') === true;
    }

    /**
     * Fetch and parse a receipt by its code or full portal URL. Throws
     * ServiceUnavailable if the portal can't be reached, and BadRequest if the
     * transaction is not found / not successful (responseCode !== "0").
     */
    async fetchParsed(codeOrUrl: string): Promise<ParsedMpesaReceipt> {
        const code = this.extractCode(codeOrUrl);
        const envelope = await this.loadReceipt(code);

        const responseCode = String(envelope.responseCode ?? '');
        const success = responseCode === '0';
        if (!success || !envelope.base64Data) {
            throw new BadRequestException(
                `M-PESA receipt ${code} was not found or not successful` +
                    (envelope.responseDescription
                        ? ` (${envelope.responseDescription})`
                        : ''),
            );
        }

        let text: string;
        try {
            const pdf = await pdfParse(
                Buffer.from(envelope.base64Data, 'base64'),
            );
            text = pdf.text ?? '';
        } catch (error) {
            throw new ServiceUnavailableException({
                message: 'Unable to read the M-PESA receipt PDF',
                detail: error instanceof Error ? error.message : String(error),
            });
        }

        const fields = parseMpesaReceiptText(text, code);
        return {
            ...fields,
            responseCode,
            responseDescription: envelope.responseDescription,
            success,
            text,
        };
    }

    /** The transaction code from a bare code, a full receipt URL, or an SMS-embedded URL. */
    extractCode(codeOrUrl: string): string {
        const trimmed = (codeOrUrl ?? '').trim();
        if (!trimmed)
            throw new BadRequestException('M-PESA receipt code is required');

        const urlMatch = trimmed.match(/https?:\/\/\S+/i);
        if (urlMatch) {
            let url: URL;
            try {
                url = new URL(urlMatch[0]);
            } catch {
                throw new BadRequestException('M-PESA receipt URL is invalid');
            }
            if (url.hostname !== MPESA_RECEIPT_HOST) {
                throw new BadRequestException(
                    'M-PESA receipt URL host is not allowed',
                );
            }
            const code = url.pathname.split('/').filter(Boolean).at(-1);
            if (!code)
                throw new BadRequestException(
                    'M-PESA receipt URL does not include a code',
                );
            return this.validateCode(code);
        }

        return this.validateCode(trimmed);
    }

    private validateCode(code: string): string {
        if (!/^[A-Za-z0-9]{8,14}$/.test(code)) {
            throw new BadRequestException('M-PESA receipt code is invalid');
        }
        return code.toUpperCase();
    }

    private async loadReceipt(code: string): Promise<ReceiptApiResponse> {
        const proxyUrl = this.configService
            .get<string>('MPESA_PORTAL_URL')
            ?.trim();
        const timeoutMs = Number(
            this.configService.get<string>('MPESA_PORTAL_TIMEOUT_MS') ?? 15000,
        );
        const key = this.configService.get<string>('MPESA_PORTAL_KEY') ?? '';
        const started = Date.now();

        const url = proxyUrl
            ? `${proxyUrl.replace(/\/+$/, '')}/getreceipt?code=${encodeURIComponent(code)}`
            : `https://${MPESA_RECEIPT_HOST}${RECEIPT_API_PATH}?trxNo=${encodeURIComponent(code)}`;

        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    ...(proxyUrl && key ? { 'x-portal-key': key } : {}),
                },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!response.ok) {
                throw new Error(
                    `M-PESA portal returned HTTP ${response.status}`,
                );
            }
            const data = (await response.json()) as ReceiptApiResponse;
            this.logger.log(
                `M-PESA receipt ${code} loaded (${proxyUrl ? 'proxy' : 'direct'}) in ${Date.now() - started}ms`,
            );
            return data;
        } catch (error) {
            this.logger.error(
                `M-PESA receipt load FAILED after ${Date.now() - started}ms (proxy=${proxyUrl ? 'on' : 'off'}): ${error instanceof Error ? error.message : error}`,
            );
            throw new ServiceUnavailableException({
                message: 'Unable to load M-PESA receipt',
                detail:
                    error instanceof Error
                        ? error.message
                        : 'Unknown M-PESA receipt error',
            });
        }
    }

    /**
     * Diagnostic probe (no DB write, no credit): fetch + parse a receipt so an ops
     * self-test can confirm the server can reach and read the M-PESA portal.
     */
    async probeReceipt(codeOrUrl: string): Promise<{
        loaded: boolean;
        parsed: boolean;
        success?: boolean;
        amount?: number;
        receiverPhone?: string;
        receiverName?: string;
        type?: string;
        error?: string;
    }> {
        try {
            const parsed = await this.fetchParsed(codeOrUrl);
            return {
                loaded: true,
                parsed: true,
                success: parsed.success,
                amount: parsed.amountBirr,
                receiverPhone: parsed.receiverPhone,
                receiverName: parsed.receiverName,
                type: parsed.transactionType,
            };
        } catch (error) {
            const detail = (error as { response?: { detail?: string } })
                ?.response?.detail;
            return {
                loaded: false,
                parsed: false,
                error:
                    detail ??
                    (error instanceof Error ? error.message : String(error)),
            };
        }
    }
}
