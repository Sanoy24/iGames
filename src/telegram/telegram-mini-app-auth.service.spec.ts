import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';

describe('TelegramMiniAppAuthService', () => {
    const botToken = '123456:telegram-test-token';
    let service: TelegramMiniAppAuthService;

    beforeEach(() => {
        service = new TelegramMiniAppAuthService({
            getOrThrow: (key: string) => {
                if (key === 'TELEGRAM_BOT_TOKEN') {
                    return botToken;
                }
                if (key === 'TELEGRAM_AUTH_MAX_AGE_SECONDS') {
                    return 60;
                }
                throw new Error(`Unexpected config key: ${key}`);
            },
        } as ConfigService);
    });

    it('validates signed Telegram Mini App initData', () => {
        const initData = buildInitData({
            botToken,
            authDateSeconds: Math.floor(Date.now() / 1000),
        });

        const result = service.validateInitData(initData);

        expect(result.user.id).toBe(12345);
        expect(result.user.username).toBe('jane_player');
        expect(result.queryId).toBe('query-1');
    });

    it('rejects tampered initData', () => {
        const initData = buildInitData({
            botToken,
            authDateSeconds: Math.floor(Date.now() / 1000),
        }).replace('jane_player', 'other_user');

        expect(() => service.validateInitData(initData)).toThrow(
            UnauthorizedException,
        );
    });

    it('rejects stale initData', () => {
        const initData = buildInitData({
            botToken,
            authDateSeconds: Math.floor(Date.now() / 1000) - 120,
        });

        expect(() => service.validateInitData(initData)).toThrow(
            UnauthorizedException,
        );
    });

    // validateInitDataAgainstToken  used by the separate agent bot, which is
    // NOT TELEGRAM_BOT_TOKEN and must never accept the main bot's signature or
    // vice versa.
    describe('validateInitDataAgainstToken', () => {
        const agentBotToken = '999999:agent-bot-test-token';

        it('validates initData signed with the GIVEN token (not TELEGRAM_BOT_TOKEN)', () => {
            const initData = buildInitData({
                botToken: agentBotToken,
                authDateSeconds: Math.floor(Date.now() / 1000),
            });

            const result = service.validateInitDataAgainstToken(
                initData,
                agentBotToken,
            );
            expect(result.user.id).toBe(12345);
        });

        it('rejects initData signed with the main bot token when checked against the agent bot token', () => {
            const initData = buildInitData({
                botToken, // signed with the MAIN bot's token
                authDateSeconds: Math.floor(Date.now() / 1000),
            });

            expect(() =>
                service.validateInitDataAgainstToken(initData, agentBotToken),
            ).toThrow(UnauthorizedException);
        });

        it('validateInitData() itself still only accepts the main bot token', () => {
            const initData = buildInitData({
                botToken: agentBotToken, // signed with the AGENT bot's token
                authDateSeconds: Math.floor(Date.now() / 1000),
            });

            expect(() => service.validateInitData(initData)).toThrow(
                UnauthorizedException,
            );
        });
    });
});

function buildInitData(input: {
    botToken: string;
    authDateSeconds: number;
}): string {
    const params = new URLSearchParams();
    params.set('auth_date', String(input.authDateSeconds));
    params.set('query_id', 'query-1');
    params.set(
        'user',
        JSON.stringify({
            id: 12345,
            first_name: 'Jane',
            last_name: 'Player',
            username: 'jane_player',
            language_code: 'en',
        }),
    );

    const dataCheckString = [...params.entries()]
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData')
        .update(input.botToken)
        .digest();
    const hash = createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');
    params.set('hash', hash);

    return params.toString();
}
