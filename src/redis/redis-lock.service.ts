import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import Redlock, { Lock, ResourceLockedError } from 'redlock';
import { REDIS_CLIENT } from './redis.constants';

// A genuine Redlock fault (not plain contention) is logged at most this often.
// Every tick of every scheduler contends, so an unthrottled handler can emit
// thousands of identical lines an hour and bury the one error that matters.
const REDLOCK_ERROR_LOG_INTERVAL_MS = 30_000;

@Injectable()
export class RedisLockService implements OnModuleDestroy {
    private readonly logger = new Logger(RedisLockService.name);
    private readonly redlock: Redlock;

    /** Throttle state for genuine (non-contention) Redlock faults. */
    private lastRedlockErrorLoggedAt = 0;
    private suppressedRedlockErrors = 0;

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
        this.redlock = new Redlock([redis], {
            driftFactor: 0.01,
            retryCount: 3,
            retryDelay: 200,
            retryJitter: 100,
            automaticExtensionThreshold: 500,
        });

        this.redlock.on('error', (err) => {
            // Losing a race for a lock is the NORMAL outcome - every scheduler
            // tick on every instance contends for the same few resources, and the
            // loser simply skips that tick. Redlock reports it by emitting a
            // ResourceLockedError here, so match on the TYPE.
            //
            // This used to test `err.message.includes('was not granted')`, which
            // is redlock v4 wording; on the v5 in use the message reads "The
            // operation was applied to: 0 of the 1 requested resources", so
            // nothing was ever suppressed and routine contention filled the error
            // log at ~10 lines a second. That is not just noise: it buried the
            // one real error ("Table 'bingo_configs' doesn't exist") that
            // explained why the Bingo bot buy-in gate was doing nothing.
            if (err instanceof ResourceLockedError) return;

            // Anything else is a real fault (quorum lost, Redis unreachable) and
            // must stay visible - but throttled, since it will also fire on every
            // tick for as long as it lasts.
            const now = Date.now();
            if (now - this.lastRedlockErrorLoggedAt < REDLOCK_ERROR_LOG_INTERVAL_MS) {
                this.suppressedRedlockErrors += 1;
                return;
            }
            const alsoSuppressed = this.suppressedRedlockErrors;
            this.suppressedRedlockErrors = 0;
            this.lastRedlockErrorLoggedAt = now;
            this.logger.error(
                `Redlock error: ${err.message}${
                    alsoSuppressed > 0
                        ? ` (+${alsoSuppressed} more in the last ${REDLOCK_ERROR_LOG_INTERVAL_MS / 1000}s)`
                        : ''
                }`,
            );
        });
    }

    /**
     * Acquires a distributed lock for `ttlMs` milliseconds.
     * Returns null if lock could not be acquired (another instance holds it).
     */
    async acquireLock(resource: string, ttlMs: number): Promise<Lock | null> {
        // A per-process fallback lock here would be worse than no lock: on a
        // multi-process host, every worker gets its own empty map and each
        // would believe it holds the only lock, defeating the whole point of
        // a *distributed* lock. Fail closed instead  skip this tick and let
        // a later one (once Redis is ready again) do the work exclusively.
        if (this.redis.status !== 'ready') {
            return null;
        }

        try {
            return await this.redlock.acquire([resource], ttlMs);
        } catch {
            return null;
        }
    }

    /** Current ioredis connection status (e.g. "ready", "connecting", "reconnecting"). */
    getStatus(): string {
        return this.redis.status;
    }

    async releaseLock(lock: Lock): Promise<void> {
        if (this.redis.status !== 'ready') {
            return;
        }

        try {
            await this.redlock.release(lock);
        } catch (err) {
            this.logger.warn(
                `Failed to release lock: ${(err as Error).message}`,
            );
        }
    }

    async onModuleDestroy() {
        await this.redlock.quit();
    }
}
