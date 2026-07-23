import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Table } from 'typeorm';
import { GamesService } from '../games/games.service';
import { PoolConfig } from './entities/pool-config.entity';
import { UpdatePoolConfigDto } from './dto/update-pool-config.dto';

/** The three admin-controlled play modes for Pool. */
export type PoolMode = 'single' | 'two_player' | 'tournament';

@Injectable()
export class PoolService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PoolService.name);
  private tableEnsured = false;

  constructor(
    @InjectRepository(PoolConfig)
    private readonly configRepo: Repository<PoolConfig>,
    private readonly dataSource: DataSource,
    private readonly gamesService: GamesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Seed the default config row on boot so admins have something to edit and
    // clients can read stable config from first request.
    await this.getConfig().catch((err) =>
      this.logger.warn(`Pool config seed skipped: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Self-heal: create the pool_config table if it doesn't exist. Belt-and-
   * suspenders so the feature works on a plain restart even if the boot-time
   * schema sync was skipped or failed for this one table. Mirrors GamesService.
   */
  private async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      const meta = this.dataSource.getMetadata(PoolConfig);
      if (!(await qr.hasTable(meta.tableName))) {
        await qr.createTable(Table.create(meta, this.dataSource.driver), true);
        this.logger.log(`Self-healed: created ${meta.tableName} table`);
      }
      this.tableEnsured = true;
    } catch (err) {
      this.logger.warn(`ensureTable failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      await qr.release();
    }
  }

  /** Read the single config row, creating defaults on first access. */
  async getConfig(): Promise<PoolConfig> {
    await this.ensureTable();
    let cfg = await this.configRepo.findOneBy({ key: 'default' });
    if (!cfg) {
      cfg = this.configRepo.create({ key: 'default' });
      await this.configRepo.save(cfg);
    }
    return cfg;
  }

  /** Admin update of the config with cross-field validation. */
  async updateConfig(dto: UpdatePoolConfigDto, adminId: string): Promise<PoolConfig> {
    const cfg = await this.getConfig();
    Object.assign(cfg, dto);

    if (cfg.minStakeMinor > cfg.maxStakeMinor) {
      throw new BadRequestException('minStakeMinor cannot exceed maxStakeMinor');
    }
    // A tournament bracket must be a power of two so every round pairs cleanly.
    if ((cfg.tournamentSize & (cfg.tournamentSize - 1)) !== 0) {
      throw new BadRequestException('tournamentSize must be a power of two (e.g. 4, 8, 16)');
    }

    cfg.updatedBy = adminId;
    return this.configRepo.save(cfg);
  }

  /** Whether a specific mode is currently open to play (config toggle only). */
  async isModeEnabled(mode: PoolMode): Promise<boolean> {
    const cfg = await this.getConfig();
    switch (mode) {
      case 'single':
        return cfg.singlePlayerEnabled;
      case 'two_player':
        return cfg.twoPlayerEnabled;
      case 'tournament':
        return cfg.tournamentEnabled;
    }
  }

  /**
   * Guard for later play endpoints: throws unless the Pool game is playable
   * (games catalog state) AND the requested mode is enabled. Defense-in-depth
   * against a stale client or direct API call.
   */
  async assertModePlayable(mode: PoolMode): Promise<void> {
    await this.gamesService.assertPlayable('pool');
    if (!(await this.isModeEnabled(mode))) {
      throw new ForbiddenException(`Pool ${mode.replace('_', ' ')} mode is currently unavailable.`);
    }
  }
}
