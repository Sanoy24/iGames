import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import Redlock, { Lock } from 'redlock';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisLockService implements OnModuleDestroy {
    private readonly logger = new Logger(RedisLockService.name);
    private readonly redlock: Redlock;

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
        this.redlock = new Redlock([redis], {
            driftFactor: 0.01,
            retryCount: 3,
            retryDelay: 200,
            retryJitter: 100,
            automaticExtensionThreshold: 500,
        });

        this.redlock.on('error', (err) => {
            // Suppress "lock already held" errors  those are normal under contention
            if (!err.message?.includes('was not granted')) {
                this.logger.error(`Redlock error: ${err.message}`);
            }
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
