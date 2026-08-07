import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
    TelegramMiniAppUser,
    ValidatedTelegramMiniAppData,
} from './types/telegram-mini-app-user';

@Injectable()
export class TelegramMiniAppAuthService {
    constructor(private readonly configService: ConfigService) {}

    /** Validates initData signed by the main player bot (TELEGRAM_BOT_TOKEN). */
    validateInitData(initData: string): ValidatedTelegramMiniAppData {
        const botToken =
            this.configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
        return this.validateInitDataAgainstToken(initData, botToken);
    }

    /**
     * Validates initData against an EXPLICIT bot token  for a separate bot
     * (e.g. the agent bot) that is not TELEGRAM_BOT_TOKEN. Kept as its own
     * public method rather than folded into validateInitData's "any registered
     * bot" style matching, so a token mix-up can never let one bot's session
     * be accepted where a different bot's is required.
     */
    validateInitDataAgainstToken(
        initData: string,
        botToken: string,
    ): ValidatedTelegramMiniAppData {
        const params = new URLSearchParams(initData);
        const receivedHash = params.get('hash');

        if (!receivedHash) {
            throw new UnauthorizedException('Telegram auth hash is missing');
        }

        params.delete('hash');

        const dataCheckString = [...params.entries()]
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const secretKey = createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();
        const calculatedHash = createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (!this.hashesMatch(calculatedHash, receivedHash)) {
            throw new UnauthorizedException('Telegram auth hash is invalid');
        }

        const authDate = this.readAuthDate(params);
        this.assertFreshAuthDate(authDate);

        const user = this.readUser(params);

        return {
            authDate,
            queryId: params.get('query_id') ?? undefined,
            startParam: params.get('start_param') ?? undefined,
            user,
        };
    }

    private hashesMatch(calculatedHash: string, receivedHash: string): boolean {
        const calculated = Buffer.from(calculatedHash, 'hex');
        const received = Buffer.from(receivedHash, 'hex');

        return (
            calculated.length === received.length &&
            timingSafeEqual(calculated, received)
        );
    }

    private readAuthDate(params: URLSearchParams): Date {
        const authDateValue = params.get('auth_date');
        if (!authDateValue) {
            throw new BadRequestException('Telegram auth_date is missing');
        }

        const authDateSeconds = Number(authDateValue);
        if (!Number.isInteger(authDateSeconds) || authDateSeconds <= 0) {
            throw new BadRequestException('Telegram auth_date is invalid');
        }

        return new Date(authDateSeconds * 1000);
    }

    private assertFreshAuthDate(authDate: Date): void {
        const maxAgeSeconds = this.configService.getOrThrow<number>(
            'TELEGRAM_AUTH_MAX_AGE_SECONDS',
        );
        const ageSeconds = (Date.now() - authDate.getTime()) / 1000;

        if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
            throw new UnauthorizedException('Telegram auth data is stale');
        }
    }

    private readUser(params: URLSearchParams): TelegramMiniAppUser {
        const userValue = params.get('user');
        if (!userValue) {
            throw new BadRequestException('Telegram user payload is missing');
        }

        try {
            const parsed = JSON.parse(userValue) as TelegramMiniAppUser;
            if (!Number.isInteger(parsed.id) || parsed.id <= 0) {
                throw new BadRequestException('Telegram user id is invalid');
            }
            return parsed;
        } catch (error) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new BadRequestException('Telegram user payload is invalid');
        }
    }
}
