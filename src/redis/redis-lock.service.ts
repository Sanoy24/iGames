import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import Redlock, { Lock } from 'redlock';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisLockService implements OnModuleDestroy {
    private readonly logger = new Logger(RedisLockService.name);
    private readonly redlock: Redlock;
    private readonly inMemoryLocks = new Map<string, { expiresAt: number }>();

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
        if (this.redis.status !== 'ready') {
            const now = Date.now();
            const existing = this.inMemoryLocks.get(resource);
            if (existing && existing.expiresAt > now) {
                return null;
            }
            this.inMemoryLocks.set(resource, { expiresAt: now + ttlMs });
            return {
                resources: [resource],
                expiration: now + ttlMs,
                value: 'mock-value',
            } as any;
        }

        try {
            return await this.redlock.acquire([resource], ttlMs);
        } catch {
            return null;
        }
    }

    async releaseLock(lock: Lock): Promise<void> {
        if (this.redis.status !== 'ready') {
            if (lock && lock.resources && lock.resources[0]) {
                this.inMemoryLocks.delete(lock.resources[0]);
            }
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
