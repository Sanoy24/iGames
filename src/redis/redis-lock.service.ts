import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import Redlock, { Lock } from 'redlock';
import { REDIS_CLIENT } from './redis.module';

@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private readonly redlock: Redlock;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {
    this.redlock = new Redlock([redis], {
      driftFactor: 0.01,
      retryCount: 3,
      retryDelay: 200,
      retryJitter: 100,
      automaticExtensionThreshold: 500,
    });

    this.redlock.on('error', (err) => {
      // Suppress "lock already held" errors — those are normal under contention
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
    try {
      return await this.redlock.acquire([resource], ttlMs);
    } catch {
      return null;
    }
  }

  async releaseLock(lock: Lock): Promise<void> {
    try {
      await this.redlock.release(lock);
    } catch (err) {
      this.logger.warn(`Failed to release lock: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.redlock.quit();
  }
}
