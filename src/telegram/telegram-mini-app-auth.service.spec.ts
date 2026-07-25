import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';

describe('TelegramMiniAppAuthService', () => {
  const botToken = '123456:telegram-test-token';
  const bingoBotToken = '654321:telegram-bingo-bot-token';
  let service: TelegramMiniAppAuthService;

  function makeService(bingoToken?: string): TelegramMiniAppAuthService {
    return new TelegramMiniAppAuthService({
      getOrThrow: (key: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') {
          return botToken;
        }
        if (key === 'TELEGRAM_AUTH_MAX_AGE_SECONDS') {
          return 60;
        }
        throw new Error(`Unexpected config key: ${key}`);
      },
      get: (key: string) => {
        if (key === 'TELEGRAM_BINGO_BOT_TOKEN') return bingoToken;
        return undefined;
      },
    } as unknown as ConfigService);
  }

  beforeEach(() => {
    service = makeService(bingoBotToken);
  });

  it('validates signed Telegram Mini App initData', () => {
    const initData = buildInitData({
      botToken,
      authDateSeconds: Math.floor(Date.now() / 1000)
    });

    const result = service.validateInitData(initData);

    expect(result.user.id).toBe(12345);
    expect(result.user.username).toBe('jane_player');
    expect(result.queryId).toBe('query-1');
  });

  it('rejects tampered initData', () => {
    const initData = buildInitData({
      botToken,
      authDateSeconds: Math.floor(Date.now() / 1000)
    }).replace('jane_player', 'other_user');

    expect(() => service.validateInitData(initData)).toThrow(UnauthorizedException);
  });

  it('rejects stale initData', () => {
    const initData = buildInitData({
      botToken,
      authDateSeconds: Math.floor(Date.now() / 1000) - 120
    });

    expect(() => service.validateInitData(initData)).toThrow(UnauthorizedException);
  });

  // Multi-bot: a second registered bot (e.g. a dedicated Bingo bot) signs
  // initData with ITS OWN token — the service must accept either bot's signature.
  it('validates initData signed by the SECOND registered bot (bingo)', () => {
    const initData = buildInitData({
      botToken: bingoBotToken,
      authDateSeconds: Math.floor(Date.now() / 1000)
    });

    const result = service.validateInitData(initData);

    expect(result.user.id).toBe(12345);
  });

  it('rejects initData signed by a token that is not any registered bot', () => {
    const initData = buildInitData({
      botToken: 'some-other-unregistered-token',
      authDateSeconds: Math.floor(Date.now() / 1000)
    });

    expect(() => service.validateInitData(initData)).toThrow(UnauthorizedException);
  });

  it('still validates the main bot when no second bot is configured', () => {
    const soloService = makeService(undefined);
    const initData = buildInitData({
      botToken,
      authDateSeconds: Math.floor(Date.now() / 1000)
    });

    expect(soloService.validateInitData(initData).user.id).toBe(12345);
  });

  it('rejects the bingo bot signature when no second bot is configured', () => {
    const soloService = makeService(undefined);
    const initData = buildInitData({
      botToken: bingoBotToken,
      authDateSeconds: Math.floor(Date.now() / 1000)
    });

    expect(() => soloService.validateInitData(initData)).toThrow(UnauthorizedException);
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
      language_code: 'en'
    })
  );

  const dataCheckString = [...params.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(input.botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);

  return params.toString();
}
