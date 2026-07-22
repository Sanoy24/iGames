import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { PoolQueueEntry } from './entities/pool-queue-entry.entity';
import { PoolMatch } from './entities/pool-match.entity';
import { PoolService } from './pool.service';
import { PoolMatchService } from './pool-match.service';
import { Seat } from './rules/rules-types';

export type JoinResult =
  | { matched: true; match: PoolMatch }
  | { matched: false; queued: true; stakeMinor: number };

@Injectable()
export class PoolMatchmakingService {
  private readonly logger = new Logger(PoolMatchmakingService.name);

  constructor(
    @InjectRepository(PoolQueueEntry)
    private readonly queueRepo: Repository<PoolQueueEntry>,
    private readonly dataSource: DataSource,
    private readonly poolService: PoolService,
    private readonly matchService: PoolMatchService,
    private readonly walletService: WalletService,
    private readonly gateway: GameEventsGateway,
  ) {}

  /**
   * Join the two-player queue at `stakeMinor`. If an opponent is already waiting
   * at the same stake, a match is created and both stakes are escrowed in one
   * transaction; otherwise the player is enqueued. A pessimistic lock on the
   * queue prevents two joiners from pairing with the same opponent.
   */
  async join(userId: string, stakeMinor: number): Promise<JoinResult> {
    await this.poolService.assertModePlayable('two_player');
    const cfg = await this.poolService.getConfig();
    if (!Number.isInteger(stakeMinor) || stakeMinor < cfg.minStakeMinor || stakeMinor > cfg.maxStakeMinor) {
      throw new BadRequestException(
        `Stake must be an integer between ${cfg.minStakeMinor} and ${cfg.maxStakeMinor}`,
      );
    }

    const result = await this.dataSource.transaction<JoinResult>(async (manager) => {
      const qRepo = manager.getRepository(PoolQueueEntry);
      const opponent = await qRepo
        .createQueryBuilder('q')
        .setLock('pessimistic_write')
        .where('q.stakeMinor = :stakeMinor', { stakeMinor })
        .andWhere('q.userId != :userId', { userId })
        .orderBy('q.createdAt', 'ASC')
        .getOne();

      if (!opponent) {
        await qRepo.delete({ userId });
        await qRepo.insert({ userId, stakeMinor });
        return { matched: false, queued: true, stakeMinor };
      }

      await qRepo.delete({ userId: opponent.userId });
      await qRepo.delete({ userId });

      const match = await this.matchService.createMatch(
        {
          mode: 'two_player',
          seatAUserId: opponent.userId,
          seatBUserId: userId,
          stakeMinor,
          breaker: 'A',
        },
        manager,
      );

      // Escrow both stakes; if either lacks funds the whole pairing rolls back.
      for (const [seat, uid] of [['A', opponent.userId], ['B', userId]] as [Seat, string][]) {
        await this.walletService.ensureDefaultWallet(uid, manager);
        await this.walletService.debitInSession(
          {
            userId: uid,
            amountMinor: stakeMinor,
            entryType: 'stake',
            sourceType: 'pool_match',
            sourceId: match.id,
            idempotencyKey: `pool-stake:${match.id}:${seat}`,
            metadata: { mode: 'two_player' },
          },
          manager,
        );
      }
      return { matched: true, match };
    });

    if (result.matched) {
      const view = this.matchService.buildView(result.match);
      for (const uid of [result.match.seatAUserId, result.match.seatBUserId]) {
        if (uid) this.gateway.emitPoolMatchFound(uid, view);
      }
      this.gateway.emitPoolMatchUpdated(result.match.id, view);
      this.logger.log(`Paired ${result.match.seatAUserId} vs ${result.match.seatBUserId} @ ${stakeMinor}`);
    }
    // Queue size just changed (a player enqueued, or a pair drained it) — refresh
    // the live counts so the Home "waiting for a Pool match" banner stays current.
    void this.gateway.broadcastLiveCounts();
    return result;
  }

  /** Leave the queue (no-op if not queued). */
  async leave(userId: string): Promise<{ removed: boolean }> {
    const res = await this.queueRepo.delete({ userId });
    if ((res.affected ?? 0) > 0) void this.gateway.broadcastLiveCounts();
    return { removed: (res.affected ?? 0) > 0 };
  }

  async status(userId: string): Promise<{ queued: boolean; stakeMinor: number | null }> {
    const entry = await this.queueRepo.findOneBy({ userId });
    return { queued: !!entry, stakeMinor: entry?.stakeMinor ?? null };
  }
}
