import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Table } from 'typeorm';
import { GamesService } from '../games/games.service';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { WerkConfig } from './entities/werk-config.entity';
import { WerkSession } from './entities/werk-session.entity';
import { UpdateWerkConfigDto } from './dto/update-werk-config.dto';
import { StartWerkGameDto } from './dto/start-werk-game.dto';
import { SettleWerkGameDto } from './dto/settle-werk-game.dto';

/** Public config the client needs to render + play a game (no secrets). */
export type WerkConfigView = {
  enabled: boolean;
  entryStakeMinor: number;
  minStakeMinor: number;
  maxStakeMinor: number;
  totalPlayers: number;
  botCount: number;
  gameDurationSec: number;
  winningMode: 'A' | 'B';
  finalSprintWarningSec: number;
  coinDensityX100: number;
  powerupsEnabled: boolean;
  mazeTheme: string;
  payoutMultsX100: number[]; // index 0 = rank 1
};

/** A started game: everything the client needs to build the identical maze. */
export type WerkSessionView = {
  id: string;
  status: 'active' | 'settled' | 'aborted';
  seed: number;
  stakeMinor: number;
  mode: 'A' | 'B';
  durationSec: number;
  totalPlayers: number;
  botCount: number;
  coinDensityX100: number;
  finalSprintWarningSec: number;
  powerupsEnabled: boolean;
  mazeTheme: string;
  payoutMultsX100: number[];
  // Present once settled:
  humanRank: number | null;
  prizeMinor: number;
};

const PAYOUT_FIELDS = [
  'payoutRank1MultX100',
  'payoutRank2MultX100',
  'payoutRank3MultX100',
  'payoutRank4MultX100',
  'payoutRank5MultX100',
] as const;

@Injectable()
export class WerkService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WerkService.name);
  private tablesEnsured = false;

  constructor(
    @InjectRepository(WerkConfig)
    private readonly configRepo: Repository<WerkConfig>,
    @InjectRepository(WerkSession)
    private readonly sessionRepo: Repository<WerkSession>,
    private readonly dataSource: DataSource,
    private readonly rngService: RngService,
    private readonly walletService: WalletService,
    private readonly gamesService: GamesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.getConfig().catch((err) =>
      this.logger.warn(`Werk config seed skipped: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Self-heal: create the werk tables if they don't exist, so the feature works
   * on a plain restart even when the boot-time schema sync was skipped. Mirrors
   * PoolService / GamesService.
   */
  private async ensureTables(): Promise<void> {
    if (this.tablesEnsured) return;
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      for (const entity of [WerkConfig, WerkSession]) {
        const meta = this.dataSource.getMetadata(entity);
        if (!(await qr.hasTable(meta.tableName))) {
          await qr.createTable(Table.create(meta, this.dataSource.driver), true);
          this.logger.log(`Self-healed: created ${meta.tableName} table`);
        }
      }
      this.tablesEnsured = true;
    } catch (err) {
      this.logger.warn(`ensureTables failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      await qr.release();
    }
  }

  // ── Config ────────────────────────────────────────────────────────────────

  /** Read the single config row, creating defaults on first access. */
  async getConfig(): Promise<WerkConfig> {
    await this.ensureTables();
    let cfg = await this.configRepo.findOneBy({ key: 'default' });
    if (!cfg) {
      cfg = this.configRepo.create({ key: 'default' });
      await this.configRepo.save(cfg);
    }
    return cfg;
  }

  private payoutMults(cfg: WerkConfig): number[] {
    return PAYOUT_FIELDS.map((f) => cfg[f]);
  }

  toConfigView(cfg: WerkConfig): WerkConfigView {
    return {
      enabled: cfg.enabled,
      entryStakeMinor: cfg.entryStakeMinor,
      minStakeMinor: cfg.minStakeMinor,
      maxStakeMinor: cfg.maxStakeMinor,
      totalPlayers: cfg.totalPlayers,
      botCount: cfg.botCount,
      gameDurationSec: cfg.gameDurationSec,
      winningMode: cfg.winningMode,
      finalSprintWarningSec: cfg.finalSprintWarningSec,
      coinDensityX100: cfg.coinDensityX100,
      powerupsEnabled: cfg.powerupsEnabled,
      mazeTheme: cfg.mazeTheme,
      payoutMultsX100: this.payoutMults(cfg),
    };
  }

  async getConfigView(): Promise<WerkConfigView> {
    return this.toConfigView(await this.getConfig());
  }

  async updateConfig(dto: UpdateWerkConfigDto, adminId: string): Promise<WerkConfig> {
    const cfg = await this.getConfig();
    Object.assign(cfg, dto);

    // Cross-field invariants.
    if (cfg.minStakeMinor > cfg.maxStakeMinor) {
      throw new BadRequestException('minStakeMinor cannot exceed maxStakeMinor');
    }
    if (cfg.entryStakeMinor < cfg.minStakeMinor || cfg.entryStakeMinor > cfg.maxStakeMinor) {
      throw new BadRequestException('entryStakeMinor must be within the stake range');
    }
    if (cfg.botCount > cfg.totalPlayers - 1) {
      throw new BadRequestException('botCount must leave room for the human (botCount <= totalPlayers - 1)');
    }

    cfg.updatedBy = adminId;
    return this.configRepo.save(cfg);
  }

  // ── Play ──────────────────────────────────────────────────────────────────

  private toSessionView(s: WerkSession, cfg: WerkConfig): WerkSessionView {
    return {
      id: s.id,
      status: s.status,
      seed: Number(s.seed),
      stakeMinor: s.stakeMinor,
      mode: s.mode,
      durationSec: s.durationSec,
      totalPlayers: s.totalPlayers,
      botCount: s.botCount,
      coinDensityX100: cfg.coinDensityX100,
      finalSprintWarningSec: cfg.finalSprintWarningSec,
      powerupsEnabled: cfg.powerupsEnabled,
      mazeTheme: cfg.mazeTheme,
      payoutMultsX100: this.payoutMults(cfg),
      humanRank: s.humanRank,
      prizeMinor: s.prizeMinor,
    };
  }

  /** Start a game: debit the stake, draw an audited layout seed, return the view. */
  async startGame(userId: string, dto: StartWerkGameDto): Promise<WerkSessionView> {
    await this.gamesService.assertPlayable('werk');
    const cfg = await this.getConfig();
    if (!cfg.enabled) throw new ForbiddenException('Werk Flega is not available right now');

    const stake = dto.stakeMinor ?? cfg.entryStakeMinor;
    if (stake < cfg.minStakeMinor || stake > cfg.maxStakeMinor) {
      throw new BadRequestException(`Stake must be between ${cfg.minStakeMinor} and ${cfg.maxStakeMinor}`);
    }

    const botCount = Math.min(cfg.botCount, cfg.totalPlayers - 1);

    const session = await this.dataSource.transaction(async (manager) => {
      // Persist the session first so its id can anchor the stake + RNG audit rows.
      const created = manager.create(WerkSession, {
        userId,
        status: 'active',
        stakeMinor: stake,
        mode: cfg.winningMode,
        durationSec: cfg.gameDurationSec,
        totalPlayers: cfg.totalPlayers,
        botCount,
        seed: 0,
        humanEliminated: false,
        coinValue: 0,
        prizeMinor: 0,
      });
      await manager.save(created);

      const debit = await this.walletService.debitInSession(
        {
          userId,
          amountMinor: stake,
          entryType: 'stake',
          sourceType: 'werk_game',
          sourceId: created.id,
          idempotencyKey: `werk-stake:${created.id}`,
          metadata: { mode: cfg.winningMode },
        },
        manager,
      );

      const draw = await this.rngService.drawSeed({
        gameType: 'werk',
        gameReference: created.id,
        metadata: { totalPlayers: cfg.totalPlayers, botCount, mode: cfg.winningMode },
        manager,
      });

      created.seed = draw.numbers[0];
      created.seedAuditLogId = draw.auditLogId ?? null;
      created.walletDebit = { ledgerEntryId: debit.ledgerEntry.id };
      await manager.save(created);
      return created;
    });

    return this.toSessionView(session, cfg);
  }

  async getSession(userId: string, id: string): Promise<WerkSessionView> {
    const s = await this.sessionRepo.findOneBy({ id });
    if (!s || s.userId !== userId) throw new NotFoundException('Game not found');
    return this.toSessionView(s, await this.getConfig());
  }

  /**
   * Server-authoritative prize for a final rank. Eliminated players and ranks
   * outside the paytable win nothing; a tie splits the rank's prize equally.
   */
  private computePrize(cfg: WerkConfig, stake: number, rank: number, tieCount: number, eliminated: boolean): number {
    if (eliminated) return 0;
    const mults = this.payoutMults(cfg);
    if (rank < 1 || rank > mults.length) return 0;
    const mult = mults[rank - 1];
    if (mult <= 0) return 0;
    const rankPrize = Math.floor((stake * mult) / 100);
    return Math.floor(rankPrize / Math.max(1, tieCount));
  }

  /** Settle a finished game from the client-reported standings; credit any prize. */
  async settle(userId: string, id: string, dto: SettleWerkGameDto): Promise<WerkSessionView> {
    const cfg = await this.getConfig();

    const settled = await this.dataSource.transaction(async (manager) => {
      const s = await manager.findOne(WerkSession, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!s || s.userId !== userId) throw new NotFoundException('Game not found');
      if (s.status === 'aborted') throw new BadRequestException('Game was aborted');
      // Idempotent: a repeated settle just echoes the stored result.
      if (s.status === 'settled') return s;

      // Clamp the client claims to the session's real participant count.
      const rank = Math.min(Math.max(1, dto.rank), s.totalPlayers);
      const tieCount = Math.min(Math.max(1, dto.tieCount), s.totalPlayers - rank + 1);
      const eliminated = s.mode === 'B' && !!dto.eliminated;
      const prize = this.computePrize(cfg, s.stakeMinor, rank, tieCount, eliminated);

      s.humanRank = rank;
      s.tieCount = tieCount;
      s.humanEliminated = eliminated;
      s.coinValue = Math.max(0, dto.coinValue);
      s.prizeMinor = prize;
      s.resultJson = { rank, tieCount, eliminated, coinValue: s.coinValue, reportedAt: new Date().toISOString() };

      if (prize > 0) {
        const credit = await this.walletService.creditInSession(
          {
            userId,
            amountMinor: prize,
            entryType: 'win',
            sourceType: 'werk_game',
            sourceId: s.id,
            idempotencyKey: `werk-prize:${s.id}`,
            metadata: { rank, tieCount },
          },
          manager,
        );
        s.walletCredit = { ledgerEntryId: credit.ledgerEntry.id };
      }

      s.status = 'settled';
      s.settledAt = new Date();
      await manager.save(s);
      return s;
    });

    return this.toSessionView(settled, cfg);
  }

  /** Abort an unfinished game (player left early): refund the stake, no prize. */
  async abort(userId: string, id: string): Promise<WerkSessionView> {
    const cfg = await this.getConfig();

    const aborted = await this.dataSource.transaction(async (manager) => {
      const s = await manager.findOne(WerkSession, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!s || s.userId !== userId) throw new NotFoundException('Game not found');
      if (s.status === 'settled') throw new BadRequestException('Game already settled');
      if (s.status === 'aborted') return s; // idempotent

      await this.walletService.creditInSession(
        {
          userId,
          amountMinor: s.stakeMinor,
          entryType: 'refund',
          sourceType: 'werk_game',
          sourceId: s.id,
          idempotencyKey: `werk-refund:${s.id}`,
          metadata: { reason: 'aborted' },
        },
        manager,
      );

      s.status = 'aborted';
      s.settledAt = new Date();
      await manager.save(s);
      return s;
    });

    return this.toSessionView(aborted, cfg);
  }
}
