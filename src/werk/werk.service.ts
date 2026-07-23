import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Table } from 'typeorm';
import { WerkConfig } from './entities/werk-config.entity';
import { WerkRound } from './entities/werk-round.entity';
import { WerkParticipant } from './entities/werk-participant.entity';
import { WerkBot } from './entities/werk-bot.entity';
import { UpdateWerkConfigDto } from './dto/update-werk-config.dto';
import { CreateWerkBotDto } from './dto/create-werk-bot.dto';
import { UpdateWerkBotDto } from './dto/update-werk-bot.dto';
import { DEFAULT_WERK_BOTS, type WerkBotPoolEntry } from './werk-bots';

/** Public config the client needs to render + play a game (no secrets). */
export type WerkConfigView = {
  enabled: boolean;
  entryStakeMinor: number;
  minStakeMinor: number;
  maxStakeMinor: number;
  totalPlayers: number;
  botCount: number;
  botMaxRealPlayers: number;
  lobbyCountdownSec: number;
  gameDurationSec: number;
  winningMode: 'A' | 'B';
  finalSprintWarningSec: number;
  coinDensityX100: number;
  powerupsEnabled: boolean;
  mazeTheme: string;
  payoutMultsX100: number[]; // index 0 = rank 1
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
    @InjectRepository(WerkBot)
    private readonly botRepo: Repository<WerkBot>,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.getConfig().catch((err) =>
      this.logger.warn(`Werk config seed skipped: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Self-heal: create the werk tables if they don't exist, so the feature works
   * on a plain restart even when the boot-time schema sync was skipped.
   */
  private async ensureTables(): Promise<void> {
    if (this.tablesEnsured) return;
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      for (const entity of [WerkConfig, WerkRound, WerkParticipant, WerkBot]) {
        const meta = this.dataSource.getMetadata(entity);
        if (!(await qr.hasTable(meta.tableName))) {
          await qr.createTable(Table.create(meta, this.dataSource.driver), true);
          this.logger.log(`Self-healed: created ${meta.tableName} table`);
        }
      }
      if ((await qr.manager.count(WerkBot)) === 0) {
        await qr.manager.insert(
          WerkBot,
          DEFAULT_WERK_BOTS.map((b, i) => ({ ...b, sortOrder: i })),
        );
        this.logger.log(`Seeded ${DEFAULT_WERK_BOTS.length} default Werk bots`);
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

  payoutMults(cfg: WerkConfig): number[] {
    return PAYOUT_FIELDS.map((f) => cfg[f]);
  }

  /** Bots that will actually spawn: none in `zero` mode, else clamped to leave the human a seat. */
  effectiveBotCount(cfg: WerkConfig): number {
    if (cfg.botSeedMode === 'zero') return 0;
    return Math.max(0, Math.min(cfg.botCount, cfg.totalPlayers - 1));
  }

  toConfigView(cfg: WerkConfig): WerkConfigView {
    return {
      enabled: cfg.enabled,
      entryStakeMinor: cfg.entryStakeMinor,
      minStakeMinor: cfg.minStakeMinor,
      maxStakeMinor: cfg.maxStakeMinor,
      totalPlayers: cfg.totalPlayers,
      botCount: this.effectiveBotCount(cfg),
      botMaxRealPlayers: cfg.botMaxRealPlayers,
      lobbyCountdownSec: cfg.lobbyCountdownSec,
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

  /**
   * Server-authoritative prize for a final rank. Eliminated players and ranks
   * outside the paytable win nothing; a tie splits the rank's prize equally.
   */
  computePrize(cfg: WerkConfig, stake: number, rank: number, tieCount: number, eliminated: boolean): number {
    if (eliminated) return 0;
    const mults = this.payoutMults(cfg);
    if (rank < 1 || rank > mults.length) return 0;
    const mult = mults[rank - 1];
    if (mult <= 0) return 0;
    const rankPrize = Math.floor((stake * mult) / 100);
    return Math.floor(rankPrize / Math.max(1, tieCount));
  }

  // ── Bots (admin-managed DB pool) ────────────────────────────────────────────

  /** The enabled bot pool a round's roster is drawn from (identity + overrides). */
  async loadBotPool(): Promise<WerkBotPoolEntry[]> {
    const bots = await this.botRepo.find({
      where: { enabled: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    return bots.map((b) => ({
      name: b.name,
      nameEn: b.nameEn,
      color: b.color,
      personality: b.personality,
      speedPct: b.speedPct,
      skillPct: b.skillPct,
    }));
  }

  async listBots(): Promise<WerkBot[]> {
    await this.getConfig();
    return this.botRepo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async createBot(dto: CreateWerkBotDto, adminId: string): Promise<WerkBot> {
    await this.getConfig();
    const bot = this.botRepo.create({ ...dto, createdBy: adminId });
    return this.botRepo.save(bot);
  }

  async updateBot(id: number, dto: UpdateWerkBotDto): Promise<WerkBot> {
    await this.getConfig();
    const bot = await this.botRepo.findOneBy({ id });
    if (!bot) throw new NotFoundException('Bot not found');
    Object.assign(bot, dto);
    return this.botRepo.save(bot);
  }

  async deleteBot(id: number): Promise<{ deleted: true }> {
    const res = await this.botRepo.delete({ id });
    if (!res.affected) throw new NotFoundException('Bot not found');
    return { deleted: true };
  }
}
