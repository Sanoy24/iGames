import { ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameEventsGateway } from '../events/game-events.gateway';
import { GameCode, GameSetting, GameState } from './entities/game-setting.entity';

/** Canonical list of games and their default display order. */
const GAME_DEFAULTS: Array<{ code: GameCode; name: string; displayOrder: number }> = [
  { code: 'bingo', name: 'Bingo', displayOrder: 0 },
  { code: 'keno', name: 'Keno', displayOrder: 1 },
  { code: 'crash', name: 'Crash', displayOrder: 2 },
];

const GAME_NAME: Record<GameCode, string> = { keno: 'Keno', bingo: 'Bingo', crash: 'Crash' };

export type GameCatalogEntry = {
  code: GameCode;
  name: string;
  state: GameState;
  maintenanceMessage: string | null;
  playable: boolean;
  displayOrder: number;
};

export type UpdateGameSettingInput = {
  state?: GameState;
  maintenanceMessage?: string | null;
  displayOrder?: number;
};

@Injectable()
export class GamesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GamesService.name);

  constructor(
    @InjectRepository(GameSetting)
    private readonly repo: Repository<GameSetting>,
    private readonly gateway: GameEventsGateway,
  ) {}

  /** Seed a row for each known game on boot so admins always have all toggles. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const g of GAME_DEFAULTS) {
        const existing = await this.repo.findOneBy({ gameCode: g.code });
        if (!existing) {
          await this.repo.save(
            this.repo.create({ gameCode: g.code, state: 'enabled', displayOrder: g.displayOrder }),
          );
          this.logger.log(`Seeded game setting for ${g.code}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Game settings seed skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  private toEntry(s: GameSetting): GameCatalogEntry {
    return {
      code: s.gameCode,
      name: GAME_NAME[s.gameCode] ?? s.gameCode,
      state: s.state,
      maintenanceMessage: s.maintenanceMessage,
      playable: s.state === 'enabled',
      displayOrder: s.displayOrder,
    };
  }

  /** Public catalog: everything that isn't hidden, ordered for display. */
  async getPublicCatalog(): Promise<GameCatalogEntry[]> {
    const rows = await this.repo.find({ order: { displayOrder: 'ASC' } });
    return rows.filter((r) => r.state !== 'hidden').map((r) => this.toEntry(r));
  }

  /** Admin view: all games including hidden ones. */
  async getAdminList(): Promise<GameCatalogEntry[]> {
    const rows = await this.repo.find({ order: { displayOrder: 'ASC' } });
    return rows.map((r) => this.toEntry(r));
  }

  async getState(code: GameCode): Promise<GameState> {
    const row = await this.repo.findOneBy({ gameCode: code });
    // Absent row = treat as enabled (fail open); it gets seeded on next boot.
    return row?.state ?? 'enabled';
  }

  async isPlayable(code: GameCode): Promise<boolean> {
    return (await this.getState(code)) === 'enabled';
  }

  /**
   * Throw if the game cannot currently be played. Used by purchase/bet endpoints
   * as defense-in-depth so a stale client or direct API call can't play a
   * disabled game.
   */
  async assertPlayable(code: GameCode): Promise<void> {
    const row = await this.repo.findOneBy({ gameCode: code });
    if (!row || row.state === 'enabled') return;
    const msg =
      row.state === 'maintenance'
        ? row.maintenanceMessage?.trim() || `${GAME_NAME[code]} is under maintenance. Please try again later.`
        : `${GAME_NAME[code]} is currently unavailable.`;
    throw new ForbiddenException(msg);
  }

  async updateSetting(code: GameCode, dto: UpdateGameSettingInput, adminId: string): Promise<GameCatalogEntry> {
    const row = await this.repo.findOneBy({ gameCode: code });
    if (!row) throw new NotFoundException(`Unknown game: ${code}`);

    if (dto.state !== undefined) row.state = dto.state;
    if (dto.maintenanceMessage !== undefined) row.maintenanceMessage = dto.maintenanceMessage?.trim() || null;
    if (dto.displayOrder !== undefined) row.displayOrder = dto.displayOrder;
    row.updatedBy = adminId;
    await this.repo.save(row);

    // Push the new public catalog so open clients hide/reveal games instantly.
    const catalog = await this.getPublicCatalog();
    this.gateway.emitGamesCatalogUpdated(catalog);

    return this.toEntry(row);
  }
}
