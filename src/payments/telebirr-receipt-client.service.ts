import {
    BadRequestException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';
import {
    ParsedTelebirrReceipt,
    TelebirrReceiptPackage,
} from './types/telebirr-receipt';

const loadCommonJsModule = createRequire(__filename);
const telebirrReceipt = loadCommonJsModule(
    'telebirr-receipt',
) as TelebirrReceiptPackage;

/**
 * A dependency-light Telebirr receipt fetch+parse client. It exists as its own
 * leaf module so the withdrawal-proof verifier (in AgentsModule) can read a
 * Telebirr receipt WITHOUT importing PaymentsModule  PaymentsModule already
 * depends on AgentsModule, so the reverse import would be a cycle.
 *
 * NOTE: the deposit path (TelebirrReceiptVerifierService) still has its own copy
 * of this fetch logic. The two are intentionally kept separate for now so this
 * change does not touch the working deposit flow; they can be unified later.
 */
@Injectable()
export class TelebirrReceiptClientService {
    private readonly logger = new Logger(TelebirrReceiptClientService.name);

    constructor(private readonly configService: ConfigService) {}

    /** Fetch and parse a receipt by its number or full Ethiotelecom URL. */
    async fetchParsed(receiptNoOrUrl: string): Promise<ParsedTelebirrReceipt> {
        const receiptNo = this.extractReceiptNo(receiptNoOrUrl);
        const html = await this.loadReceipt(receiptNo);
        const parsed = telebirrReceipt.utils.parseFromHTML(html);
        // Ensure the receipt number is present for dedupe/reference downstream.
        if (!parsed.receiptNo) parsed.receiptNo = receiptNo;
        return parsed;
    }

    /** Telebirr statuses we treat as a completed transaction. */
    isAcceptedTransactionStatus(status: string | undefined): boolean {
        if (!status) return false;
        return ['completed', 'success', 'successful', 'paid'].some((accepted) =>
            status.toLowerCase().includes(accepted),
        );
    }

    private async loadReceipt(receiptNo: string): Promise<string> {
        const proxyUrl = this.configService
            .get<string>('TELEBIRR_PROXY_URL')
            ?.trim();
        try {
            if (proxyUrl) {
                return await this.loadReceiptViaProxy(
                    proxyUrl.replace(/\/+$/, ''),
                    receiptNo,
                );
            }
            return await telebirrReceipt.utils.loadReceipt({ receiptNo });
        } catch (error) {
            this.logger.error(
                `Payout receipt load FAILED (proxy=${proxyUrl ? 'on' : 'off'}): ${error instanceof Error ? error.message : error}`,
            );
            throw new ServiceUnavailableException({
                message: 'Unable to load Telebirr receipt',
                detail:
                    error instanceof Error
                        ? error.message
                        : 'Unknown Telebirr receipt error',
            });
        }
    }

    private async loadReceiptViaProxy(
        baseUrl: string,
        receiptNo: string,
    ): Promise<string> {
        const key = this.configService.get<string>('TELEBIRR_PROXY_KEY') ?? '';
        const timeoutMs = Number(
            this.configService.get<string>('TELEBIRR_PROXY_TIMEOUT_MS') ??
                15000,
        );
        const response = await fetch(
            `${baseUrl}/fetchreceipt?receiptNo=${encodeURIComponent(receiptNo)}`,
            {
                headers: key ? { 'x-proxy-key': key } : {},
                signal: AbortSignal.timeout(timeoutMs),
            },
        );
        if (!response.ok) {
            throw new Error(`Telebirr proxy returned HTTP ${response.status}`);
        }
        const data = (await response.json()) as { html?: string };
        if (!data?.html) {
            throw new Error('Telebirr proxy returned no receipt HTML');
        }
        return data.html;
    }

    private extractReceiptNo(receiptNoOrUrl: string): string {
        const trimmed = receiptNoOrUrl.trim();
        if (!trimmed)
            throw new BadRequestException(
                'Telebirr receipt number is required',
            );

        if (!trimmed.startsWith('http')) return this.validateReceiptNo(trimmed);

        let url: URL;
        try {
            url = new URL(trimmed);
        } catch {
            throw new BadRequestException('Telebirr receipt URL is invalid');
        }
        if (url.hostname !== 'transactioninfo.ethiotelecom.et') {
            throw new BadRequestException(
                'Telebirr receipt URL host is not allowed',
            );
        }
        const receiptNo = url.pathname.split('/').filter(Boolean).at(-1);
        if (!receiptNo) {
            throw new BadRequestException(
                'Telebirr receipt URL does not include a receipt number',
            );
        }
        return this.validateReceiptNo(receiptNo);
    }

    private validateReceiptNo(receiptNo: string): string {
        if (!/^[A-Za-z0-9_-]{4,80}$/.test(receiptNo)) {
            throw new BadRequestException('Telebirr receipt number is invalid');
        }
        return receiptNo;
    }
}
