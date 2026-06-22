type AuthMode = 'telegram_only' | 'standalone' | 'hybrid';

type EnvConfig = {
  NODE_ENV: string;
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD?: string;
  DB_DATABASE: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_AUTH_MAX_AGE_SECONDS: number;
  TELEGRAM_MINIAPP_URL: string;
  TELEGRAM_WEBHOOK_URL?: string;
  AUTH_MODE: AuthMode;
  TELEBIRR_EXPECTED_RECEIVER_NAME: string;
  TELEBIRR_EXPECTED_RECEIVER_ACCOUNT: string;
  TELEBIRR_CREDIT_MINOR_PER_BIRR: number;
  SENTRY_DSN: string;
  ALLOWED_ORIGIN: string;
  THROTTLE_TTL_SECONDS: number;
  THROTTLE_MAX_REQUESTS: number;
};

const AUTH_MODES: AuthMode[] = ['telegram_only', 'standalone', 'hybrid'];

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const config = {
    NODE_ENV: readString(raw, 'NODE_ENV', 'development'),
    PORT: readNumber(raw, 'PORT', 3000),
    DB_HOST: readString(raw, 'DB_HOST', 'localhost'),
    DB_PORT: readNumber(raw, 'DB_PORT', 3306),
    DB_USERNAME: readString(raw, 'DB_USERNAME'),
    DB_PASSWORD: readString(raw, 'DB_PASSWORD', ''),
    DB_DATABASE: readString(raw, 'DB_DATABASE'),
    REDIS_URL: readString(raw, 'REDIS_URL', 'redis://localhost:6379'),
    JWT_ACCESS_SECRET: readString(raw, 'JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: readString(raw, 'JWT_REFRESH_SECRET'),
    JWT_ACCESS_TTL: readString(raw, 'JWT_ACCESS_TTL', '15m'),
    JWT_REFRESH_TTL: readString(raw, 'JWT_REFRESH_TTL', '30d'),
    TELEGRAM_BOT_TOKEN: readString(raw, 'TELEGRAM_BOT_TOKEN'),
    TELEGRAM_AUTH_MAX_AGE_SECONDS: readNumber(raw, 'TELEGRAM_AUTH_MAX_AGE_SECONDS', 86400),
    TELEGRAM_MINIAPP_URL: readString(raw, 'TELEGRAM_MINIAPP_URL', ''),
    TELEGRAM_WEBHOOK_URL: readString(raw, 'TELEGRAM_WEBHOOK_URL', ''),
    AUTH_MODE: readAuthMode(raw),
    TELEBIRR_EXPECTED_RECEIVER_NAME: readString(raw, 'TELEBIRR_EXPECTED_RECEIVER_NAME', ''),
    TELEBIRR_EXPECTED_RECEIVER_ACCOUNT: readString(raw, 'TELEBIRR_EXPECTED_RECEIVER_ACCOUNT', ''),
    TELEBIRR_CREDIT_MINOR_PER_BIRR: readNumber(raw, 'TELEBIRR_CREDIT_MINOR_PER_BIRR', 100),
    SENTRY_DSN: readString(raw, 'SENTRY_DSN', ''),
    ALLOWED_ORIGIN: readString(raw, 'ALLOWED_ORIGIN', '*'),
    THROTTLE_TTL_SECONDS: readNumber(raw, 'THROTTLE_TTL_SECONDS', 60),
    THROTTLE_MAX_REQUESTS: readNumber(raw, 'THROTTLE_MAX_REQUESTS', 120),
  };

  return config;
}

function readString(raw: Record<string, unknown>, key: string, defaultValue?: string): string {
  const value = raw[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(`Missing required environment variable: ${key}`);
}

function readNumber(raw: Record<string, unknown>, key: string, defaultValue: number): number {
  const value = raw[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

function readAuthMode(raw: Record<string, unknown>): AuthMode {
  const value = readString(raw, 'AUTH_MODE', 'hybrid');
  if (AUTH_MODES.includes(value as AuthMode)) {
    return value as AuthMode;
  }
  throw new Error(`AUTH_MODE must be one of: ${AUTH_MODES.join(', ')}`);
}
