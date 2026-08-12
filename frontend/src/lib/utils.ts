import axios from 'axios';

export function createIdempotencyKey(prefix: string): string {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatCreditsFull(minor: number): string {
    return new Intl.NumberFormat().format(minor);
}

/**
 * Online-player counts never show a real number below 15  low counts read as
 * an empty platform, so anything under the threshold is shown as "10+"
 * instead. At 15 or above, the actual number is shown.
 */
export function formatOnlineCount(n: number): string {
    return n < 15 ? '10+' : String(n);
}

/**
 * All user-facing dates render in Ethiopia time (EAT, UTC+3) regardless of the
 * device/webview timezone  timestamps are stored in UTC, so we must pin the zone
 * here or players in a UTC (or other) locale see the wrong clock.
 */
export const ETHIOPIA_TZ = 'Africa/Addis_Ababa';

export function formatDateTime(
    value: string | number | Date | undefined,
): string {
    if (!value) {
        return 'TBD';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'TBD';
    }

    return new Intl.DateTimeFormat('en-GB', {
        timeZone: ETHIOPIA_TZ,
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(date);
}

/** Full date + time in Ethiopia time, 12-hour (e.g. "17/07/2026, 6:57:30 pm"). */
export function formatDateTimeFull(
    value: string | number | Date | undefined,
): string {
    if (!value) {
        return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: ETHIOPIA_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    }).format(date);
}

export function formatRelativeTime(
    value: string | number | Date | undefined,
): string {
    if (!value) {
        return 'Unknown time';
    }

    const date = value instanceof Date ? value : new Date(value);
    const ms = date.getTime() - Date.now();
    const minutes = Math.round(ms / 60000);

    if (Math.abs(minutes) < 1) {
        return 'Now';
    }

    if (Math.abs(minutes) < 60) {
        return `${Math.abs(minutes)} min ${minutes < 0 ? 'ago' : 'from now'}`;
    }

    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) {
        return `${Math.abs(hours)} hr ${hours < 0 ? 'ago' : 'from now'}`;
    }

    const days = Math.round(hours / 24);
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days < 0 ? 'ago' : 'from now'}`;
}

export function getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
        if (!error.response) {
            return 'Unable to connect to the server. Please check your internet connection and try again.';
        }

        const serverMessage = error.response?.data?.message;
        if (typeof serverMessage === 'string') {
            return sanitizeServerMessage(serverMessage);
        }
        if (
            Array.isArray(serverMessage) &&
            serverMessage.every((item) => typeof item === 'string')
        ) {
            return serverMessage.map(sanitizeServerMessage).join(', ');
        }
        return 'Connection problem occurred. Please try again later.';
    }

    if (error instanceof Error) {
        return sanitizeServerMessage(error.message);
    }

    return 'Something went wrong';
}

/**
 * True for a transient/infrastructure failure where retrying the exact same
 * request could plausibly succeed  no response at all (network/timeout) or a
 * 503 from the backend (e.g. TelebirrReceiptClientService/MpesaReceiptClientService
 * couldn't reach their upstream proxy). False for a validation/business
 * rejection (400/409/etc), where the same input will just fail again.
 */
export function isRetryableInfraError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    return error.response.status === 503;
}

function sanitizeServerMessage(msg: string): string {
    const lower = msg.toLowerCase();
    const indicators = [
        'localhost',
        '127.0.0.1',
        'mongodb',
        'mongo',
        'database',
        'db:',
        'connection refused',
        'network error',
        'nest',
        'stack',
        'internal server error',
        'exception',
        'query',
        'mongoose',
        'axios',
        'http://',
        'https://',
    ];

    if (indicators.some((ind) => lower.includes(ind))) {
        return 'A service error occurred. Please try again later.';
    }

    return msg;
}

export function titleCase(value: string): string {
    return value
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
