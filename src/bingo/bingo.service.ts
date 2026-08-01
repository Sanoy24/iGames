import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository, EntityManager, DataSource, In, IsNull, LessThan, LessThanOrEqual, MoreThan, Not, FindOptionsWhere } from 'typeorm';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { BingoRulesService, BUILT_IN_PATTERNS } from './bingo-rules.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { UpdateBingoConfigDto } from './dto/update-bingo-config.dto';
import { CreateBingoPatternDto, UpdateBingoPatternDto } from './dto/create-bingo-pattern.dto';
import { BingoConfig } from './entities/bingo-config.entity';
import { BingoBotIdentity, BingoRoom, BingoPrizeTier, BingoWinMode } from './entities/bingo-room.entity';
import { BingoGrid, BingoTicket } from './entities/bingo-ticket.entity';
import { BingoCard } from './entities/bingo-card.entity';
import { BingoPattern } from './entities/bingo-pattern.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { GamesService } from '../games/games.service';
import { User } from '../users/entities/user.entity';
import { BotName } from '../bots/entities/bot-name.entity';

/** Prefilled/derash finishing places, in award order. */
export type PrefilledPlace = '1st' | '2nd' | '3rd' | '4th' | '5th';
export const PREFILLED_PLACES: PrefilledPlace[] = ['1st', '2nd', '3rd', '4th', '5th'];

const FINAL_CARTELA_RETURN_LOCK_MS = 3_000;

type RoomBotIdentity = BingoBotIdentity;

// ── Pure derash-leaderboard ranking (exported for deterministic tests) ──────────

export type DerashLeaderboardCard = {
  /** Caller-chosen identifier (e.g. cartela number or an index into the ticket list). */
  key: number;
  grid: (number | null)[][];
  /** Purchase-order tiebreak — lower = bought earlier. */
  order: number;
};

export type DerashLeaderboardRank = {
  key: number;
  /** Index into `places` of the hardest place-pattern reached (0 = 1st/hardest). */
  bestRank: number;
  /** 1-based draw index at which that hardest pattern was reached. */
  reachedAt: number;
  order: number;
};

/**
 * Pure: the 1-based draw index at which `grid` FIRST completes each place's pattern
 * (absent = never completed within `drawnNumbers`). No DB, no side effects.
 */
export function derashCompletionIndex(
  bingoRules: BingoRulesService,
  grid: (number | null)[][],
  drawnNumbers: number[],
  placePattern: Map<PrefilledPlace, BingoPattern>,
): Map<PrefilledPlace, number> {
  const completion = new Map<PrefilledPlace, number>();
  const partial: number[] = [];
  for (let k = 0; k < drawnNumbers.length; k += 1) {
    partial.push(drawnNumbers[k]);
    for (const [place, pattern] of placePattern) {
      if (completion.has(place)) continue;
      const state = bingoRules.evaluatePatternTicket(grid, partial, [pattern]);
      if (state.completedPatternIds.includes(pattern.id)) completion.set(place, k + 1);
    }
    if (completion.size === placePattern.size) break;
  }
  return completion;
}

/**
 * Pure leaderboard ranking. Orders cards by **hardest place-pattern reached** →
 * **earliest to reach it** → **purchase order**, and returns them in queue order
 * (best first). The caller assigns `places[i]` to `result[i]` up to `places.length`.
 * Cards that completed no pattern are omitted (they win nothing). This is the exact
 * logic `settleDerashLeaderboard` uses — extracted so it can be tested without a DB.
 */
export function rankDerashLeaderboard(
  bingoRules: BingoRulesService,
  cards: DerashLeaderboardCard[],
  drawnNumbers: number[],
  places: PrefilledPlace[],
  placePattern: Map<PrefilledPlace, BingoPattern>,
): DerashLeaderboardRank[] {
  const ranked: DerashLeaderboardRank[] = [];
  for (const card of cards) {
    const completion = derashCompletionIndex(bingoRules, card.grid, drawnNumbers, placePattern);
    let bestRank = Number.POSITIVE_INFINITY;
    let reachedAt = Number.POSITIVE_INFINITY;
    places.forEach((place, idx) => {
      const at = completion.get(place);
      if (at !== undefined && idx < bestRank) {
        bestRank = idx;
        reachedAt = at;
      }
    });
    if (bestRank !== Number.POSITIVE_INFINITY) {
      ranked.push({ key: card.key, bestRank, reachedAt, order: card.order });
    }
  }
  ranked.sort((a, b) => a.bestRank - b.bestRank || a.reachedAt - b.reachedAt || a.order - b.order);
  return ranked;
}

export type BingoRoomResponse = {
  id: string;
  name: string;
  status: string;
  ticketPriceMinor: number;
  maxTickets: number;
  soldTickets: number;
  prizes: Record<string, number>;
  winMode: string;
  numberRange: number;
  gridSize: number;
  patternPrizes: Array<{ patternId: string; name: string; prizeMinor: number }>;
  scheduledStartAt: Date | null;
  createdAt: Date;
  drawnNumbers: number[];
  settledTiers: string[];
  winnersByTier: Record<string, string[]>;
  settlementSummary: Record<string, unknown>;
  houseEdgePct: number;
  prizeMinor: number;
  takenSpots?: number[];
  resultDisplaySeconds?: number;
};

export type BingoTicketResponse = {
  id: string;
  userId: string;
  roomId: string;
  cartelaNumber?: number | null;
  grid: Array<Array<number | null>>;
  markedNumbers: number[];
  completedLines: number[];
  wonTiers: string[];
  completedPatterns: string[];
  stakeMinor: number;
  payoutMinor: number;
  status: string;
  settlementStatus: string;
  autoClaim: boolean;
  /** Manual-mode disqualification audit (null/false/0 when not disqualified). */
  disqualifiedReason?: string | null;
  disqualifiedWonRound?: boolean;
  forfeitedWinMinor?: number;
};

const MIN_BINGO_SALES_WINDOW_MS = 15_000;

@Injectable()
export class BingoService implements OnModuleInit {
  private readonly logger = new Logger(BingoService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BingoRoom)
    private readonly bingoRoomRepository: Repository<BingoRoom>,
    @InjectRepository(BotName)
    private readonly botNameRepository: Repository<BotName>,
    @InjectRepository(BingoTicket)
    private readonly bingoTicketRepository: Repository<BingoTicket>,
    @InjectRepository(BingoCard)
    private readonly bingoCardRepository: Repository<BingoCard>,
    @InjectRepository(BingoConfig)
    private readonly bingoConfigRepository: Repository<BingoConfig>,
    @InjectRepository(BingoPattern)
    private readonly bingoPatternRepository: Repository<BingoPattern>,
    private readonly bingoRulesService: BingoRulesService,
    private readonly rngService: RngService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly gamesService: GamesService
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedBuiltInPatterns();
    } catch (err) {
      this.logger.warn('Failed to seed built-in bingo patterns on startup', err);
    }
  }

  // ── Patterns ────────────────────────────────────────────────────────────────

  async listPatterns(): Promise<BingoPattern[]> {
    return this.bingoPatternRepository.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async createPattern(dto: CreateBingoPatternDto): Promise<BingoPattern> {
    const pattern = this.bingoPatternRepository.create({ ...dto, isBuiltIn: false });
    return this.bingoPatternRepository.save(pattern);
  }

  async updatePattern(id: string, dto: UpdateBingoPatternDto): Promise<BingoPattern> {
    const pattern = await this.bingoPatternRepository.findOneBy({ id });
    if (!pattern) throw new NotFoundException('Bingo pattern not found');
    Object.assign(pattern, dto);
    return this.bingoPatternRepository.save(pattern);
  }

  async deletePattern(id: string): Promise<void> {
    const pattern = await this.bingoPatternRepository.findOneBy({ id });
    if (!pattern) throw new NotFoundException('Bingo pattern not found');
    if (pattern.isBuiltIn) throw new BadRequestException('Built-in patterns cannot be deleted');
    await this.bingoPatternRepository.remove(pattern);
  }

  async seedBuiltInPatterns(): Promise<BingoPattern[]> {
    const existing = await this.bingoPatternRepository.findBy({ isBuiltIn: true });
    const existingNames = new Set(existing.map((p) => p.name));

    const toCreate = BUILT_IN_PATTERNS.filter((p) => !existingNames.has(p.name));
    if (toCreate.length === 0) return existing;

    const created = await this.bingoPatternRepository.save(
      toCreate.map((p) => this.bingoPatternRepository.create({ ...p, isBuiltIn: true, enabled: true })),
    );
    this.logger.log(`Seeded ${created.length} built-in bingo patterns`);
    return [...existing, ...created];
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  async listBotNames(): Promise<Array<{ id: string; displayName: string; active: boolean; createdAt: Date; updatedAt: Date }>> {
    const names = await this.botNameRepository.find({
      order: { active: 'DESC', displayName: 'ASC', createdAt: 'ASC' },
    });
    return names.map((name) => this.toBotNameResponse(name));
  }

  async createBotName(dto: { displayName: string; active?: boolean }): Promise<{ id: string; displayName: string; active: boolean; createdAt: Date; updatedAt: Date }> {
    const displayName = this.normalizeBotName(dto.displayName);
    if (!displayName) throw new BadRequestException('Bot name is required');

    const existing = await this.botNameRepository.findOneBy({ displayName });
    if (existing) throw new ConflictException('Bot name already exists');

    const name = this.botNameRepository.create({
      displayName,
      active: dto.active ?? true,
    });
    return this.toBotNameResponse(await this.botNameRepository.save(name));
  }

  async importBotNames(dto: { names: string[] }): Promise<Array<{ id: string; displayName: string; active: boolean; createdAt: Date; updatedAt: Date }>> {
    const normalized = [...new Set(dto.names.map((name) => this.normalizeBotName(name)).filter(Boolean))];
    if (normalized.length === 0) return [];

    const existing = await this.botNameRepository.find({
      where: { displayName: In(normalized) },
      select: ['displayName'],
    });
    const existingNames = new Set(existing.map((row) => row.displayName));
    const toCreate = normalized
      .filter((name) => !existingNames.has(name))
      .map((displayName) => this.botNameRepository.create({ displayName, active: true }));

    if (toCreate.length === 0) return [];
    return (await this.botNameRepository.save(toCreate)).map((name) => this.toBotNameResponse(name));
  }

  async updateBotName(
    id: string,
    dto: { displayName?: string; active?: boolean },
  ): Promise<{ id: string; displayName: string; active: boolean; createdAt: Date; updatedAt: Date }> {
    const name = await this.botNameRepository.findOneBy({ id });
    if (!name) throw new NotFoundException('Bot name not found');

    if (dto.displayName !== undefined) {
      const displayName = this.normalizeBotName(dto.displayName);
      if (!displayName) throw new BadRequestException('Bot name is required');
      if (displayName !== name.displayName) {
        const conflict = await this.botNameRepository.findOneBy({ displayName });
        if (conflict && conflict.id !== name.id) {
          throw new ConflictException('Bot name already exists');
        }
      }
      name.displayName = displayName;
    }
    if (dto.active !== undefined) {
      name.active = dto.active;
    }
    return this.toBotNameResponse(await this.botNameRepository.save(name));
  }

  async deleteBotName(id: string): Promise<void> {
    const name = await this.botNameRepository.findOneBy({ id });
    if (!name) throw new NotFoundException('Bot name not found');
    await this.botNameRepository.remove(name);
  }

  async getBingoConfig(): Promise<BingoConfig> {
    let cfg = await this.bingoConfigRepository.findOneBy({ key: 'global' });
    if (!cfg) {
      cfg = this.bingoConfigRepository.create({
        key: 'global',
        enabled: true,
        autoRepeatIntervalMinutes: 0,
        defaultTicketPriceMinor: 500,
        defaultMaxTickets: 200,
        maxCartelasPerUser: 0,
        defaultOneLineMinor: 20000,
        defaultTwoLinesMinor: 50000,
        defaultFullHouseMinor: 100000,
        drawIntervalSeconds: 2,
        salesWindowSeconds: 40,
        resultDisplaySeconds: 10,
        defaultWinMode: 'prefilled',
        defaultNumberRange: 75,
        defaultGridSize: 75,
        prefilledRankingMode: 'race',
        prefilledFirstPlacePct: 80,
        prefilledSecondPlaceEnabled: false,
        prefilledSecondPlacePct: 0,
        prefilledThirdPlaceEnabled: false,
        prefilledThirdPlacePct: 0,
        prefilledFourthPlaceEnabled: false,
        prefilledFourthPlacePct: 0,
        prefilledFifthPlaceEnabled: false,
        prefilledFifthPlacePct: 0,
        prefilledWinPatternId: null,
        prefilledFirstPatternId: null,
        prefilledSecondPatternId: null,
        prefilledThirdPatternId: null,
        prefilledFourthPatternId: null,
        prefilledFifthPatternId: null,
      });
      await this.bingoConfigRepository.save(cfg);
    }
    return cfg;
  }

  private isBotUser(user?: Pick<User, 'productMetadata'> | null): boolean {
    return !!user?.productMetadata?.botPolicy;
  }

  private normalizeBotName(displayName: string): string {
    return (displayName ?? '').trim().replace(/\s+/g, ' ');
  }

  private formatBotPhoneSuffix(phoneSuffix: string): string {
    return `09******${phoneSuffix.padStart(4, '0')}`;
  }

  private formatBotDisplayName(displayName: string, phoneSuffix: string): string {
    return `${displayName} (${this.formatBotPhoneSuffix(phoneSuffix)})`;
  }

  private pickUniqueBotSuffix(usedSuffixes: Set<string>): string {
    if (usedSuffixes.size >= 10_000) {
      return String(randomInt(0, 10_000)).padStart(4, '0');
    }

    let suffix = String(randomInt(0, 10_000)).padStart(4, '0');
    while (usedSuffixes.has(suffix)) {
      suffix = String(randomInt(0, 10_000)).padStart(4, '0');
    }
    usedSuffixes.add(suffix);
    return suffix;
  }

  private shuffle<T>(values: T[]): T[] {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = randomInt(0, i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  private toBotNameResponse(name: BotName): { id: string; displayName: string; active: boolean; createdAt: Date; updatedAt: Date } {
    return {
      id: name.id,
      displayName: name.displayName,
      active: name.active,
      createdAt: name.createdAt,
      updatedAt: name.updatedAt,
    };
  }

  private async hydrateRoomBotIdentities(
    room: BingoRoom,
    userIds: string[],
    manager?: EntityManager,
  ): Promise<Record<string, RoomBotIdentity>> {
    const runner = manager ?? this.bingoRoomRepository.manager;
    const roomRepo = runner.getRepository(BingoRoom);
    const botRepo = runner.getRepository(BotName);
    const userRepo = runner.getRepository(User);

    const requestedIds = [...new Set(userIds.filter(Boolean))];
    if (requestedIds.length === 0) {
      return (room.botIdentityMap ?? {}) as Record<string, RoomBotIdentity>;
    }

    const users = await userRepo.find({
      where: { id: In(requestedIds) },
      select: ['id', 'displayName', 'productMetadata'],
      order: { createdAt: 'ASC' },
    });
    const activeBots = users.filter((user) => this.isBotUser(user));
    if (activeBots.length === 0) {
      return (room.botIdentityMap ?? {}) as Record<string, RoomBotIdentity>;
    }

    const identityMap = { ...((room.botIdentityMap ?? {}) as Record<string, RoomBotIdentity>) };
    const usedNames = new Set(Object.values(identityMap).map((identity) => identity.displayName));
    const usedSuffixes = new Set(Object.values(identityMap).map((identity) => identity.phoneSuffix));
    const activeNames = this.shuffle(
      (await botRepo.find({
        where: { active: true },
        order: { displayName: 'ASC', createdAt: 'ASC' },
      })).map((row) => this.normalizeBotName(row.displayName)).filter(Boolean),
    ).filter((name) => !usedNames.has(name));

    let fallbackIndex = 1;
    for (const bot of this.shuffle(activeBots)) {
      if (identityMap[bot.id]) continue;
      const baseName = activeNames.shift() ?? this.normalizeBotName(bot.displayName);
      const displayName = baseName || `Bot ${fallbackIndex++}`;
      const uniqueDisplayName = usedNames.has(displayName)
        ? `${displayName} ${fallbackIndex++}`
        : displayName;
      usedNames.add(uniqueDisplayName);
      const phoneSuffix = this.pickUniqueBotSuffix(usedSuffixes);
      identityMap[bot.id] = {
        displayName: uniqueDisplayName,
        phoneSuffix,
      };
    }

    const next = Object.keys(identityMap).length > 0 ? identityMap : (room.botIdentityMap ?? {});
    if (JSON.stringify(room.botIdentityMap ?? {}) !== JSON.stringify(next)) {
      room.botIdentityMap = next;
      await roomRepo.save(room);
    }
    return next;
  }

  async ensureRoomBotIdentities(roomId: string, userIds: string[], manager?: EntityManager): Promise<Record<string, RoomBotIdentity>> {
    const runner = manager ?? this.bingoRoomRepository.manager;
    const room = await runner.getRepository(BingoRoom).findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('Bingo room not found');
    return this.hydrateRoomBotIdentities(room, userIds, manager);
  }

  private async resolveDisplayedNameForUser(
    room: BingoRoom,
    user: Pick<User, 'id' | 'displayName' | 'phoneNumber' | 'productMetadata'>,
    manager?: EntityManager,
  ): Promise<{ displayName: string; phoneLast4: string; phoneSuffix?: string; isBot: boolean }> {
    const isBot = this.isBotUser(user);
    if (!isBot) {
      return {
        displayName: user.displayName ?? 'Player',
        phoneLast4: (user.phoneNumber ?? '').replace(/\D/g, '').slice(-4),
        phoneSuffix: undefined,
        isBot: false,
      };
    }

    const identities = await this.hydrateRoomBotIdentities(room, [user.id], manager);
    const identity = identities[user.id];
    const displayName = identity
      ? this.formatBotDisplayName(identity.displayName, identity.phoneSuffix)
      : user.displayName ?? 'Bot';
    return {
      displayName,
      phoneLast4: '',
      phoneSuffix: identity?.phoneSuffix,
      isBot: true,
    };
  }

  /**
   * Buy-window countdown length, in ms — identical to the delay the room used to
   * be created with. Floored to a sane minimum and never shorter than the
   * configured auto-repeat interval. Stamped onto scheduledStartAt when the FIRST
   * ticket of an idle room is sold, so the countdown length is unchanged; only
   * the moment it STARTS moves from room-creation to first-purchase.
   */
  startCountdownDelayMs(cfg: BingoConfig): number {
    const salesWindowMs = Math.max((cfg.salesWindowSeconds ?? 40) * 1000, MIN_BINGO_SALES_WINDOW_MS);
    return Math.max((cfg.autoRepeatIntervalMinutes ?? 0) * 60_000, salesWindowMs);
  }

  /**
   * Kick off the buy-window countdown the moment the FIRST ticket of an idle room
   * is sold. `wasEmpty` = the room had zero sold tickets before this purchase, so
   * the countdown is stamped exactly once (fixed window); later purchases pass
   * false and never move the start time. It OVERWRITES any pre-existing value so a
   * stale creation-time default (from a legacy DEFAULT CURRENT_TIMESTAMP column)
   * is corrected to "now + window" from the real first-sale moment. MUST be called
   * while the room row is locked FOR UPDATE (as in purchaseTickets) so concurrent
   * first sales can't double-stamp.
   */
  private startCountdownOnFirstSale(room: BingoRoom, cfg: BingoConfig, wasEmpty: boolean): void {
    if (wasEmpty) {
      room.scheduledStartAt = new Date(Date.now() + this.startCountdownDelayMs(cfg));
    }
  }

  /**
   * One-time, idempotent self-heal: relax bingo_rooms.scheduledStartAt to NULLable
   * so a room can be created IDLE (no countdown) until its first ticket is sold.
   * The additive schema-sync only adds new columns; it never alters an existing
   * NOT NULL column, so this bridges live databases created before idle rooms.
   * Safe to run every boot — it only ALTERs when the column is still NOT NULL.
   */
  async ensureRoomSchema(): Promise<void> {
    try {
      const rows: Array<{ IS_NULLABLE: string; COLUMN_DEFAULT: string | null; EXTRA: string }> =
        await this.bingoRoomRepository.query(
          `SELECT IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bingo_rooms' AND COLUMN_NAME = 'scheduledStartAt'`,
        );
      const col = rows[0];
      // Re-write the column definition whenever it is NOT NULL, carries a
      // CURRENT_TIMESTAMP default, or has ON UPDATE CURRENT_TIMESTAMP. The last two
      // are the real culprits behind "countdown starts on its own": a bare
      // `timestamp` column silently defaults to NOW() on insert AND resets to NOW()
      // on every row update, so an idle room's start time appears out of nowhere.
      const needsFix =
        !col ||
        col.IS_NULLABLE === 'NO' ||
        (col.COLUMN_DEFAULT != null && /current_timestamp/i.test(col.COLUMN_DEFAULT)) ||
        /on update/i.test(col.EXTRA ?? '');
      if (needsFix) {
        await this.bingoRoomRepository.query(
          `ALTER TABLE bingo_rooms MODIFY COLUMN scheduledStartAt timestamp NULL DEFAULT NULL`,
        );
        this.logger.log(
          'Schema self-heal: bingo_rooms.scheduledStartAt is now NULLable with no auto CURRENT_TIMESTAMP (idle rooms)',
        );
      }
      // Clean up legacy idle rooms: any OPEN room that has sold nothing must have no
      // countdown. This clears a stale start time left by the old behaviour so the
      // current idle room stops showing a timer the moment the fix boots.
      const cleared: { affectedRows?: number } = await this.bingoRoomRepository.query(
        `UPDATE bingo_rooms SET scheduledStartAt = NULL WHERE status = 'open' AND soldTickets = 0`,
      );
      if (cleared?.affectedRows) {
        this.logger.log(`Schema self-heal: reset ${cleared.affectedRows} idle open Bingo room(s) to no-countdown`);
      }
    } catch (err) {
      this.logger.error(
        'Schema self-heal for bingo_rooms.scheduledStartAt failed',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async updateBingoConfig(dto: UpdateBingoConfigDto): Promise<BingoConfig> {
    const cfg = await this.getBingoConfig();
    Object.assign(cfg, dto);
    const saved = await this.bingoConfigRepository.save(cfg);
    // Apply a win-mode change right away: if the currently open room no longer
    // matches the configured mode, autoCreateNextRoom cancels it and opens a
    // fresh room in the new mode (no-op when the open room already matches).
    await this.autoCreateNextRoom().catch(() => undefined);
    return saved;
  }

  /**
   * Enforce the invariant "at most one active Bingo room, and it matches the
   * current admin config". Cancels (and refunds) every active — open OR running
   * — room except the single well-formed one to keep.
   *
   * "Well-formed" means the room's win mode matches the config AND its ball pool
   * matches (e.g. a stale `DERASH 1-200` room is cancelled while the config says
   * 75). Preferring a *running* well-formed room avoids killing a game already in
   * progress; otherwise the earliest well-formed open room is kept. Returns the
   * kept room, or null if none survived (so the caller can create a fresh one).
   *
   * This is the single guard that stops the "two games at once / count jumps
   * 75 → 45 / draws to /200" symptoms, regardless of legacy rows in the DB.
   */
  /**
   * Ball pool size per mode. Standard 75-ball derash is FIXED at 75 (the
   * B/I/N/G/O columns only line up at 75), 90-ball line is fixed at 90, and only
   * pattern mode honours the admin "Ball Pool" setting. This is what prevents a
   * derash room from ever drawing numbers above 75 (e.g. the bad 1-200 rooms).
   */
  private ballPoolFor(winMode: BingoWinMode, cfg: BingoConfig): number {
    if (winMode === 'line') return 90;
    if (winMode === 'prefilled') return 75;
    return cfg.defaultNumberRange ?? 75;
  }

  async reconcileActiveRooms(cfg?: BingoConfig): Promise<BingoRoom | null> {
    const config = cfg ?? (await this.getBingoConfig());
    const winMode = (config.defaultWinMode as BingoWinMode) ?? 'prefilled';
    const expectedRange = this.ballPoolFor(winMode, config);

    const active = await this.bingoRoomRepository.find({
      where: { status: In(['open', 'running']) },
      order: { scheduledStartAt: 'ASC' },
    });
    if (active.length === 0) return null;

    const matches = (r: BingoRoom) =>
      r.winMode === winMode && (r.numberRange ?? expectedRange) === expectedRange;

    const keep =
      active.find((r) => r.status === 'running' && matches(r)) ??
      active.find((r) => matches(r)) ??
      null;

    for (const room of active) {
      if (keep && room.id === keep.id) continue;
      await this.cancelRoom(room.id).catch((err) =>
        this.logger.warn(
          `reconcile: failed to cancel stale room ${room.id} (${room.winMode} range=${room.numberRange} status=${room.status})`,
          err,
        ),
      );
    }
    return keep;
  }

  async autoCreateNextRoom(): Promise<BingoRoomResponse | null> {
    const cfg = await this.getBingoConfig();
    if (!cfg.enabled) return null;

    // Collapse to a single well-formed active room. If one already exists (open
    // or running) we do not create another — one game at a time.
    const kept = await this.reconcileActiveRooms(cfg);
    if (kept) return null;

    // No active room exists, so the single "active game" slot must be free. If a
    // completed/cancelled room leaked its activeGuard (never got cleared), the
    // unique index would reject the next INSERT and the game would stop restarting
    // after a win — exactly the "no new round after the result dialog" symptom.
    // Release any leaked slot before claiming it below.
    await this.bingoRoomRepository.query(
      `UPDATE bingo_rooms SET activeGuard = NULL WHERE activeGuard IS NOT NULL AND status IN ('completed','cancelled')`,
    );

    const created = await this.createIdleRoom(cfg, null, 1);
    if (created) {
      this.logger.log(`Auto-created idle Bingo room "${created.name}" — countdown starts on first ticket sale`);
    }
    return created;
  }

  /**
   * Build + persist one IDLE room (scheduledStartAt NULL — never draws until the
   * first ticket is sold). `ownerAgentId` NULL = house room. `activeGuard` = 1
   * claims the global single-active-game slot (shared-room mode); NULL opts out of
   * that guard (per-agent mode, where many rooms run concurrently).
   */
  private async createIdleRoom(
    cfg: BingoConfig,
    ownerAgentId: string | null,
    activeGuard: number | null,
    ownerName?: string,
  ): Promise<BingoRoomResponse | null> {
    const winMode = (cfg.defaultWinMode as BingoWinMode) ?? 'prefilled';
    const gridSize = cfg.defaultGridSize ?? 75;
    const timestamp = new Date().toLocaleTimeString('en-US', {
      timeZone: 'Africa/Addis_Ababa', // room name shows Ethiopia time (12h) regardless of server TZ
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const name = ownerName ? `${ownerName} · Bingo` : `Bingo ${timestamp}`;

    const room = this.bingoRoomRepository.create({
      name,
      status: 'open',
      ticketPriceMinor: cfg.defaultTicketPriceMinor,
      maxTickets: winMode === 'prefilled' ? gridSize : cfg.defaultMaxTickets,
      prizes: {
        oneLineMinor: cfg.defaultOneLineMinor,
        twoLinesMinor: cfg.defaultTwoLinesMinor,
        fullHouseMinor: cfg.defaultFullHouseMinor,
      },
      winMode,
      numberRange: this.ballPoolFor(winMode, cfg),
      gridSize,
      patternPrizes: [],
      houseEdgePct: cfg.houseEdgePct ?? 20,
      rankingMode: cfg.prefilledRankingMode ?? 'race',
      scheduledStartAt: null,
      drawnNumbers: [],
      rngAuditLogIds: [],
      settledTiers: [],
      winnersByTier: {},
      settlementSummary: {},
      activeGuard,
      ownerAgentId,
    });

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(room);
        await this.generateCardPoolForRoom(room, manager);
      });
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        this.logger.warn('Active Bingo room already exists (activeGuard conflict) — skipping creation');
        return null;
      }
      throw err;
    }
    return this.toRoomResponse(room, 0, []);
  }

  /** Is per-agent room mode (Approach B) enabled by the admin? */
  async isAgentRoomsEnabled(): Promise<boolean> {
    try {
      const rows: Array<{ v: number | boolean | null }> = await this.bingoRoomRepository.query(
        "SELECT agentRoomsEnabled v FROM system_configs WHERE `key` = 'global' LIMIT 1",
      );
      return !!rows[0]?.v;
    } catch {
      return false;
    }
  }

  /**
   * Per-agent mode: make sure the house AND every active agent each have exactly
   * one active (open/running) idle room. Creates missing ones and de-dupes extras
   * (keeps a running room, else the earliest, cancels the rest). Runs each tick
   * inside the scheduler's Redis lock, so creation is single-writer.
   */
  async ensureAgentRooms(cfg?: BingoConfig): Promise<void> {
    const config = cfg ?? (await this.getBingoConfig());
    if (!config.enabled) return;

    const agents: Array<{ id: string; displayName: string }> = await this.bingoRoomRepository.query(
      `SELECT id, displayName FROM users WHERE status = 'active' AND JSON_CONTAINS(roles, '"agent"')`,
    );
    const owners: Array<{ ownerAgentId: string | null; name?: string }> = [
      { ownerAgentId: null }, // house room
      ...agents.map((a) => ({ ownerAgentId: a.id, name: a.displayName })),
    ];

    for (const owner of owners) {
      const active = await this.bingoRoomRepository.find({
        where: { ownerAgentId: owner.ownerAgentId ?? IsNull(), status: In(['open', 'running']) },
        order: { scheduledStartAt: 'ASC' },
      });
      if (active.length === 0) {
        await this.createIdleRoom(config, owner.ownerAgentId, null, owner.name).catch((err) =>
          this.logger.error('ensureAgentRooms create failed', err instanceof Error ? err.stack : err),
        );
      } else if (active.length > 1) {
        const keep = active.find((r) => r.status === 'running') ?? active[0];
        for (const r of active) {
          if (r.id !== keep.id) await this.cancelRoom(r.id).catch(() => undefined);
        }
      }
    }
  }

  /**
   * Per-agent mode version of findRoomsToStart: returns EVERY open room that is due
   * and has tickets, as long as its owner has no game already running (one live
   * game per owner, but many owners run concurrently).
   */
  async findAgentRoomsToStart(): Promise<BingoRoomResponse[]> {
    const dueOpen = await this.bingoRoomRepository.find({
      where: { status: 'open', soldTickets: MoreThan(0), scheduledStartAt: LessThanOrEqual(new Date()) },
      order: { scheduledStartAt: 'ASC' },
    });
    const out: BingoRoomResponse[] = [];
    for (const room of dueOpen) {
      const runningForOwner = await this.bingoRoomRepository.countBy({
        ownerAgentId: room.ownerAgentId ?? IsNull(),
        status: 'running',
      });
      if (runningForOwner > 0) continue;
      const sold = await this.countSoldTickets(room.id);
      if (sold <= 0) continue;
      out.push(this.toRoomResponse(room, sold));
    }
    return out;
  }

  /**
   * Lobby of joinable rooms (per-agent mode). Every active (open/running) room with
   * its owner-agent name, price, players and pot — so a customer can pick which
   * agent's room to play. `enabled` reflects the admin toggle so the client knows
   * whether to show the lobby at all.
   */
  async getLobby(): Promise<{
    enabled: boolean;
    rooms: Array<{
      id: string;
      name: string;
      status: string;
      ownerAgentId: string | null;
      ownerName: string;
      ticketPriceMinor: number;
      players: number;
      potMinor: number;
      scheduledStartAt: Date | null;
    }>;
  }> {
    const enabled = await this.isAgentRoomsEnabled();
    const rows: Array<{
      id: string;
      name: string;
      status: string;
      ownerAgentId: string | null;
      ownerName: string | null;
      ticketPriceMinor: number;
      soldTickets: number;
      scheduledStartAt: Date | null;
    }> = await this.bingoRoomRepository.query(
      `SELECT r.id, r.name, r.status, r.ownerAgentId, u.displayName ownerName,
              r.ticketPriceMinor, r.soldTickets, r.scheduledStartAt
         FROM bingo_rooms r
         LEFT JOIN users u ON u.id = r.ownerAgentId
        WHERE r.status IN ('open','running')
        ORDER BY (r.ownerAgentId IS NULL) DESC, u.displayName ASC, r.scheduledStartAt ASC`,
    );
    return {
      enabled,
      rooms: rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        ownerAgentId: r.ownerAgentId,
        ownerName: r.ownerAgentId ? (r.ownerName ?? 'Agent') : 'House',
        ticketPriceMinor: Number(r.ticketPriceMinor),
        players: Number(r.soldTickets ?? 0),
        potMinor: Number(r.soldTickets ?? 0) * Number(r.ticketPriceMinor),
        scheduledStartAt: r.scheduledStartAt,
      })),
    };
  }

  /**
   * Credit the room-owning agent their commission when an agent room completes
   * (Approach B). Commission = agentRoomCommissionPct % of the room's REAL-player
   * GGR (staked − paid out, bots excluded — bot money isn't real revenue). Idempotent
   * per room (`bingo-room-commission:<roomId>`), so it's safe to call once at
   * completion. No-op for house rooms (null owner), when the pct is 0, or GGR ≤ 0.
   */
  async settleAgentRoomCommission(roomId: string): Promise<void> {
    try {
      const room = await this.bingoRoomRepository.findOneBy({ id: roomId });
      if (!room || !room.ownerAgentId || room.status !== 'completed') return;

      const cfgRows: Array<{ pct: number | string | null }> = await this.bingoRoomRepository.query(
        "SELECT agentRoomCommissionPct pct FROM system_configs WHERE `key` = 'global' LIMIT 1",
      );
      const pct = Number(cfgRows[0]?.pct ?? 0);
      if (pct <= 0) return;

      const ggrRows: Array<{ staked: number | string; payout: number | string }> =
        await this.bingoRoomRepository.query(
          `SELECT COALESCE(SUM(t.stakeMinor),0) staked, COALESCE(SUM(t.payoutMinor),0) payout
             FROM bingo_tickets t
             JOIN users u ON u.id = t.userId
            WHERE t.roomId = ? AND t.status <> 'cancelled'
              AND JSON_EXTRACT(u.productMetadata, '$.botPolicy') IS NULL`,
          [roomId],
        );
      const ggrMinor = Number(ggrRows[0]?.staked ?? 0) - Number(ggrRows[0]?.payout ?? 0);
      if (ggrMinor <= 0) return;

      const commissionMinor = Math.floor((ggrMinor * pct) / 100);
      if (commissionMinor <= 0) return;

      await this.dataSource.transaction(async (manager) => {
        await this.walletService.creditInSession(
          {
            userId: room.ownerAgentId!,
            amountMinor: commissionMinor,
            entryType: 'agent_receipt',
            sourceType: 'bingo_room_commission',
            sourceId: room.id,
            idempotencyKey: `bingo-room-commission:${room.id}`,
            metadata: { roomId: room.id, ggrMinor, commissionPct: pct, kind: 'bingo_room_commission' },
          },
          manager,
        );
      });
      this.logger.log(
        `Agent room commission: room ${roomId} → agent ${room.ownerAgentId} credited ${commissionMinor} (${pct}% of real GGR ${ggrMinor})`,
      );
    } catch (err) {
      this.logger.error('settleAgentRoomCommission failed', err instanceof Error ? err.stack : err);
    }
  }

  /**
   * Credit each REFERRING agent (User.referredByAgentId) their commission on the
   * REAL-player GGR their own referred players generated in this room — independent
   * of room ownership, so it composes with `settleAgentRoomCommission` above rather
   * than replacing it (a player referred by Agent A playing in Agent B's owned room
   * pays both). Commission % is per-agent (`User.referralCommissionPct`) if set,
   * else the global `SystemConfig.referralCommissionPct` default. Idempotent per
   * (room, agent) — `bingo-referral-commission:<roomId>:<agentId>`.
   */
  async settleReferralCommission(roomId: string): Promise<void> {
    try {
      const room = await this.bingoRoomRepository.findOneBy({ id: roomId });
      if (!room || room.status !== 'completed') return;

      const cfgRows: Array<{ pct: number | string | null }> = await this.bingoRoomRepository.query(
        "SELECT referralCommissionPct pct FROM system_configs WHERE `key` = 'global' LIMIT 1",
      );
      const globalPct = Number(cfgRows[0]?.pct ?? 0);

      const rows: Array<{ agentId: string; staked: number | string; payout: number | string }> =
        await this.bingoRoomRepository.query(
          `SELECT u.referredByAgentId AS agentId,
                  COALESCE(SUM(t.stakeMinor),0) staked,
                  COALESCE(SUM(t.payoutMinor),0) payout
             FROM bingo_tickets t
             JOIN users u ON u.id = t.userId
            WHERE t.roomId = ? AND t.status <> 'cancelled'
              AND JSON_EXTRACT(u.productMetadata, '$.botPolicy') IS NULL
              AND u.referredByAgentId IS NOT NULL
            GROUP BY u.referredByAgentId`,
          [roomId],
        );
      if (rows.length === 0) return;

      const agentIds = rows.map((r) => r.agentId);
      const agents = await this.bingoRoomRepository.manager.findBy(User, { id: In(agentIds) });
      const overridePctByAgentId = new Map(agents.map((a) => [a.id, a.referralCommissionPct ?? null]));

      for (const row of rows) {
        const ggrMinor = Number(row.staked) - Number(row.payout);
        if (ggrMinor <= 0) continue;

        const overridePct = overridePctByAgentId.get(row.agentId) ?? null;
        const pct = overridePct ?? globalPct;
        if (pct <= 0) continue;

        const commissionMinor = Math.floor((ggrMinor * pct) / 100);
        if (commissionMinor <= 0) continue;

        await this.dataSource.transaction(async (manager) => {
          await this.walletService.creditInSession(
            {
              userId: row.agentId,
              amountMinor: commissionMinor,
              entryType: 'agent_receipt',
              sourceType: 'bingo_referral_commission',
              sourceId: room.id,
              idempotencyKey: `bingo-referral-commission:${room.id}:${row.agentId}`,
              metadata: { roomId: room.id, ggrMinor, commissionPct: pct, kind: 'referral_commission' },
            },
            manager,
          );
        });
        this.logger.log(
          `Referral commission: room ${roomId} → agent ${row.agentId} credited ${commissionMinor} (${pct}% of referred-player GGR ${ggrMinor})`,
        );
      }
    } catch (err) {
      this.logger.error('settleReferralCommission failed', err instanceof Error ? err.stack : err);
    }
  }

  /**
   * Generate and persist a room's fixed card pool. Prefilled/derash only: the
   * pool of `gridSize` unique 75-ball cards is created once, atomically with the
   * room, before any ticket sales. Cartela numbers are 1..N in pool order.
   */
  private async generateCardPoolForRoom(room: BingoRoom, manager: EntityManager): Promise<void> {
    if (room.winMode !== 'prefilled') return;
    const count = room.gridSize ?? 75;
    const numberRange = room.numberRange ?? 75;
    const pool = this.bingoRulesService.generateUniqueCardPool(count, numberRange);
    const cards = pool.map((c, index) =>
      manager.create(BingoCard, {
        roomId: room.id,
        cartelaNumber: index + 1,
        grid: c.grid,
        cardHash: c.hash,
        assignedTicketId: null,
        assignedUserId: null,
      }),
    );
    // Insert in chunks so a large pool (e.g. 500) stays within a bounded query size.
    const CHUNK = 200;
    for (let i = 0; i < cards.length; i += CHUNK) {
      await manager.save(cards.slice(i, i + CHUNK));
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    const e = err as { code?: string; errno?: number; driverError?: { code?: string; errno?: number } };
    return (
      e?.code === 'ER_DUP_ENTRY' ||
      e?.errno === 1062 ||
      e?.driverError?.code === 'ER_DUP_ENTRY' ||
      e?.driverError?.errno === 1062
    );
  }

  // ── Rooms ────────────────────────────────────────────────────────────────────

  async listRunningRooms(): Promise<BingoRoomResponse[]> {
    const rooms = await this.bingoRoomRepository.findBy({ status: 'running' });
    if (rooms.length === 0) return [];

    const roomIds = rooms.map((r) => r.id);
    const counts = await this.bingoTicketRepository
      .createQueryBuilder('ticket')
      .select('ticket.roomId', 'roomId')
      .addSelect('COUNT(ticket.id)', 'count')
      .where('ticket.roomId IN (:...roomIds)', { roomIds })
      .groupBy('ticket.roomId')
      .getRawMany();

    const countMap = new Map(counts.map((c) => [c.roomId, Number(c.count)]));
    return rooms.map((room) => this.toRoomResponse(room, countMap.get(room.id) ?? 0));
  }

  async getCurrentRoom(userId?: string): Promise<(BingoRoomResponse & { tickets?: BingoTicketResponse[] }) | null> {
    // Pure read: never create rooms here. Room creation is owned solely by the
    // scheduler (single instance, Redis-locked). Creating rooms from this
    // client-polled endpoint caused a race where many concurrent polls each
    // spawned a room, producing several games running at once.
    const cfg = await this.getBingoConfig();
    const resultWindowSec = Math.max(1, cfg.resultDisplaySeconds ?? 10);

    // A running game always takes priority.
    let room = await this.bingoRoomRepository.findOne({
      where: { status: 'running' },
      order: { scheduledStartAt: 'ASC' },
    });

    // A JUST-completed room stays "current" for its result-display window so the
    // client can show the win / no-win overlay before we advance. Without this,
    // the next room (opened the instant the game ends) would immediately replace
    // the result and the dialog would never appear. Compare updatedAt to the DB's
    // own NOW() so the session timezone offset cancels out.
    if (!room) {
      const recent: Array<{ id: string }> = await this.bingoRoomRepository.query(
        `SELECT id FROM bingo_rooms WHERE status = 'completed' AND updatedAt >= (NOW() - INTERVAL ? SECOND) ORDER BY updatedAt DESC LIMIT 1`,
        [resultWindowSec],
      );
      if (recent.length > 0) {
        room = await this.bingoRoomRepository.findOneBy({ id: recent[0].id });
      }
    }

    // Otherwise the next open room, then finally the most recent completed one.
    if (!room) {
      room =
        (await this.bingoRoomRepository.findOne({
          where: { status: 'open' },
          order: { scheduledStartAt: 'ASC' },
        })) ??
        (await this.bingoRoomRepository.findOne({
          where: { status: 'completed' },
          order: { updatedAt: 'DESC' },
        }));
    }

    if (!room) return null;
    return this.getRoomState({ roomId: room.id, userId });
  }

  async findRunningRoomIdsDue(intervalSeconds: number): Promise<string[]> {
    // Compare updatedAt against the DB's own NOW() rather than an app-side JS Date.
    // updatedAt is populated by the database, so mixing it with a driver-serialized
    // Date can misfire under a non-UTC MySQL session timezone (the offset makes the
    // row look "in the future" and it never becomes due). Comparing column-to-NOW()
    // keeps both sides in the same session timezone, so the offset cancels out.
    const seconds = Math.max(1, intervalSeconds);
    const rows: Array<{ id: string }> = await this.bingoRoomRepository.query(
      `SELECT id FROM bingo_rooms WHERE status = 'running' AND updatedAt <= (NOW() - INTERVAL ? SECOND)`,
      [seconds],
    );
    return rows.map((r) => r.id);
  }

  async findRoomsToStart(): Promise<BingoRoomResponse[]> {
    // One game at a time. Never start another game while one is already running,
    // and start only the single earliest due room even if several are open.
    // This is what prevents the "called count reaches 75 then jumps back to 45"
    // symptom: that happens when two rooms draw concurrently and the client flips
    // from the finishing game to one that was already mid-draw. Extra open rooms
    // are cancelled/refunded by autoCreateNextRoom on the same tick.
    const runningCount = await this.bingoRoomRepository.countBy({ status: 'running' });
    if (runningCount > 0) return [];

    // A room is IDLE until its FIRST ticket is sold. Requiring soldTickets > 0 here
    // is the hard guard that keeps an unplayed room from ever starting — no draws,
    // no "player win window" — even if scheduledStartAt was populated by a legacy
    // `DEFAULT CURRENT_TIMESTAMP` column instead of our first-sale stamp.
    const room = await this.bingoRoomRepository.findOne({
      where: { status: 'open', soldTickets: MoreThan(0), scheduledStartAt: LessThanOrEqual(new Date()) },
      order: { scheduledStartAt: 'ASC' },
    });
    if (!room) return [];

    // Belt-and-suspenders: trust the authoritative ticket count, not just the
    // denormalised counter, so a drifted soldTickets can't start an empty game.
    const soldTickets = await this.countSoldTickets(room.id);
    if (soldTickets <= 0) return [];
    return [this.toRoomResponse(room, soldTickets)];
  }

  async createRoom(dto: CreateBingoRoomDto): Promise<BingoRoomResponse> {
    const cfg = await this.getBingoConfig();
    const winMode = (dto.winMode as BingoWinMode) ?? 'prefilled';
    const gridSize = dto.gridSize ?? cfg.defaultGridSize ?? 75;

    const room = this.bingoRoomRepository.create({
      name: dto.name,
      status: 'open',
      ticketPriceMinor: dto.ticketPriceMinor,
      maxTickets: winMode === 'prefilled' ? gridSize : dto.maxTickets,
      prizes: dto.prizes,
      winMode,
      // Derash is fixed 75-ball; only pattern mode honours an explicit numberRange.
      numberRange: winMode === 'pattern' ? (dto.numberRange ?? cfg.defaultNumberRange ?? 75) : this.ballPoolFor(winMode, cfg),
      gridSize,
      patternPrizes: dto.patternPrizes ?? [],
      houseEdgePct: cfg.houseEdgePct ?? 20,
      rankingMode: cfg.prefilledRankingMode ?? 'race',
      scheduledStartAt: dto.scheduledStartAt ? new Date(dto.scheduledStartAt) : new Date(),
      drawnNumbers: [],
      rngAuditLogIds: [],
      settledTiers: [],
      winnersByTier: {},
      settlementSummary: {},
    });

    // Room + its card pool are created atomically (prefilled only) so ticket
    // sales can never begin before the full pool exists.
    await this.dataSource.transaction(async (manager) => {
      await manager.save(room);
      await this.generateCardPoolForRoom(room, manager);
    });
    return this.toRoomResponse(room, 0, []);
  }

  async listRooms(): Promise<BingoRoomResponse[]> {
    // createdAt, not scheduledStartAt — the latter is NULL until the first
    // ticket sells, which shoved idle/cancelled-before-start rooms (including
    // the current OPEN room) to the bottom regardless of how recent they are.
    const rooms = await this.bingoRoomRepository.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });
    if (rooms.length === 0) return [];

    const roomIds = rooms.map((room) => room.id);
    const counts = await this.bingoTicketRepository
      .createQueryBuilder('ticket')
      .select('ticket.roomId', 'roomId')
      .addSelect('COUNT(ticket.id)', 'count')
      .where('ticket.roomId IN (:...roomIds)', { roomIds })
      .groupBy('ticket.roomId')
      .getRawMany();

    const countsByRoomId = new Map(counts.map((count) => [count.roomId, Number(count.count)]));
    return rooms.map((room) => this.toRoomResponse(room, countsByRoomId.get(room.id) ?? 0));
  }

  async listTicketsForUser(input: { userId: string; limit: number }): Promise<BingoTicketResponse[]> {
    this.validateUuid(input.userId, 'userId');
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const tickets = await this.bingoTicketRepository.find({
      where: { userId: input.userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return tickets.map((ticket) => this.toTicketResponse(ticket));
  }

  async findStuckRooms(thresholdMinutes = 10): Promise<string[]> {
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60000);
    const rooms = await this.bingoRoomRepository.find({
      where: { status: In(['open', 'running']), scheduledStartAt: LessThan(thresholdDate) },
    });
    return rooms.map((r) => r.id);
  }

  async getRoomState(input: {
    roomId: string;
    userId?: string;
  }): Promise<BingoRoomResponse & { tickets?: BingoTicketResponse[] }> {
    this.validateUuid(input.roomId, 'roomId');
    const room = await this.findRoom(input.roomId);
    const soldTickets = await this.countSoldTickets(room.id);

    let takenSpots: number[] | undefined;
    if (room.winMode === 'prefilled') {
      takenSpots = await this.getTakenSpots(room.id);
    }

    const response: BingoRoomResponse & { tickets?: BingoTicketResponse[] } = this.toRoomResponse(room, soldTickets, takenSpots);

    if (input.userId) {
      this.validateUuid(input.userId, 'userId');
      // Exclude cancelled (refunded) tickets — a released cartela must stop
      // counting as owned so its grid cell reverts to the available style.
      const tickets = await this.bingoTicketRepository.find({
        where: { roomId: room.id, userId: input.userId, status: Not('cancelled') },
        order: { createdAt: 'DESC' },
      });
      response.tickets = tickets.map((ticket) => this.toTicketResponse(ticket));
    }

    return response;
  }

  /**
   * Full round detail for the admin — everything needed to audit/trace a game:
   * the room (with drawn numbers, settled places, per-place winner summary, and
   * RNG audit log ids), pot/prize totals, and EVERY cartela in the round with
   * its owner, status (won/lost/disqualified/cancelled), payout, and card grid.
   */
  async getRoomAdminDetails(roomId: string) {
    const validId = this.validateUuid(roomId, 'roomId');
    const room = await this.bingoRoomRepository.findOneBy({ id: validId });
    if (!room) throw new NotFoundException('Bingo room not found');

    const soldTickets = await this.countSoldTickets(room.id);
    const takenSpots = room.winMode === 'prefilled' ? await this.getTakenSpots(room.id) : undefined;
    const roomResponse = this.toRoomResponse(room, soldTickets, takenSpots);

    const tickets = await this.bingoTicketRepository.find({
      where: { roomId: room.id },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    const houseEdgePct = room.houseEdgePct ?? 20;
    const totalPotMinor = soldTickets * room.ticketPriceMinor;
    const prizePoolMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));
    const totalPaidOutMinor = tickets.reduce((sum, t) => sum + Number(t.payoutMinor), 0);
    const ticketRows = await Promise.all(
      tickets.map(async (t) => {
        const display = t.user
          ? await this.resolveDisplayedNameForUser(room, t.user, this.bingoRoomRepository.manager)
          : { displayName: 'Player', phoneLast4: '', isBot: false };
        return {
          id: t.id,
          userId: t.userId,
          userName: display.displayName,
          phoneLast4: display.phoneLast4,
          isBot: display.isBot,
          cartelaNumber: t.cartelaNumber ?? null,
          status: t.status,
          settlementStatus: t.settlementStatus,
          autoClaim: t.autoClaim ?? true,
          stakeMinor: t.stakeMinor,
          payoutMinor: Number(t.payoutMinor),
          wonTiers: t.wonTiers ?? [],
          disqualifiedReason: t.disqualifiedReason ?? null,
          disqualifiedWonRound: t.disqualifiedWonRound ?? false,
          forfeitedWinMinor: Number(t.forfeitedWinMinor ?? 0),
          forfeitedPlaces: t.forfeitedPlaces ?? [],
          grid: t.grid,
          markedNumbers: t.markedNumbers ?? [],
          createdAt: t.createdAt,
        };
      }),
    );

    return {
      room: {
        ...roomResponse,
        rankingMode: room.rankingMode,
        rngAuditLogIds: room.rngAuditLogIds ?? [],
        createdAt: room.createdAt,
      },
      totals: {
        soldTickets,
        totalPotMinor,
        prizePoolMinor,
        totalPaidOutMinor,
        houseEdgePct,
      },
      tickets: ticketRows,
    };
  }

  async purchaseTickets(input: {
    userId: string;
    roomId: string;
    count?: number;
    cartelaNumbers?: number[];
    idempotencyKey: string;
    selectedNumbers?: number[];
  }): Promise<BingoTicketResponse[]> {
    await this.gamesService.assertPlayable('bingo');
    const userId = this.validateUuid(input.userId, 'userId');
    const roomId = this.validateUuid(input.roomId, 'roomId');

    return await this.dataSource.transaction(async (manager) => {
      const existingTickets = await manager.find(BingoTicket, {
        where: { userId, roomId, purchaseIdempotencyKey: input.idempotencyKey },
      });
      if (existingTickets.length > 0) {
        return existingTickets.map((ticket) => this.toTicketResponse(ticket));
      }

      const room = await manager.findOne(BingoRoom, {
        where: { id: roomId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!room) throw new NotFoundException('Bingo room not found');
      if (room.status !== 'open') throw new ConflictException('Bingo room is not open for ticket sales');

      // ── Per-user cartela cap (admin config; 0 = unlimited) ───────────────────
      // Counts how many cartelas this purchase adds and rejects if it would push
      // the user past the configured limit for this room. Counted across all of
      // the user's non-cancelled tickets in the room, not just this transaction.
      const cfg = await this.getBingoConfig();
      const maxPerUser = cfg.maxCartelasPerUser ?? 0;
      const requestedCartelas = room.winMode === 'prefilled'
        ? new Set(input.cartelaNumbers ?? []).size
        : (input.count ?? 1);
      if (maxPerUser > 0) {
        const alreadyOwned = await manager.countBy(BingoTicket, {
          userId,
          roomId,
          status: Not('cancelled'),
        });
        if (alreadyOwned + requestedCartelas > maxPerUser) {
          const remaining = Math.max(0, maxPerUser - alreadyOwned);
          throw new ConflictException(
            remaining === 0
              ? `You have reached the limit of ${maxPerUser} cartela${maxPerUser === 1 ? '' : 's'} for this game`
              : `You can buy at most ${maxPerUser} cartela${maxPerUser === 1 ? '' : 's'} in this game — ${remaining} remaining`,
          );
        }
      }

      // ── Prefilled / derash mode: buy one or more cartela cards ───────────────
      if (room.winMode === 'prefilled') {
        const gridSize = room.gridSize ?? 75;
        const requested = input.cartelaNumbers ?? [];
        // De-duplicate within the batch, preserving order.
        const cartelaNumbers = [...new Set(requested)];
        if (cartelaNumbers.length === 0) {
          throw new BadRequestException('Select at least one cartela number');
        }
        for (const n of cartelaNumbers) {
          if (!Number.isSafeInteger(n) || n < 1 || n > gridSize) {
            throw new BadRequestException(`Cartela number must be between 1 and ${gridSize}`);
          }
        }
        // Back-compat: a room created before the card-pool architecture has no
        // pool. Build it once here (the room row is already locked FOR UPDATE, so
        // this is race-safe) so legacy in-flight rooms keep selling instead of
        // reporting "full". New rooms always have their pool from creation.
        const poolSize = await manager.countBy(BingoCard, { roomId });
        if (poolSize === 0) {
          await this.generateCardPoolForRoom(room, manager);
        }

        // Game full: no unassigned cards left in the pool.
        const availableCards = await manager.countBy(BingoCard, {
          roomId,
          assignedTicketId: IsNull(),
        });
        if (availableCards === 0) {
          throw new ConflictException('Bingo room is full — all cards have been assigned');
        }
        if (cartelaNumbers.length > availableCards) {
          throw new ConflictException('Not enough cartelas remaining in this room');
        }

        const createdTickets: BingoTicket[] = [];

        for (const [index, cartelaNumber] of cartelaNumbers.entries()) {
          // Assign — never generate. Lock the pool card for this cartela and
          // require it to be unassigned. The row lock makes concurrent buys of
          // the same cartela race-safe (one wins, the other sees it taken).
          const card = await manager.findOne(BingoCard, {
            where: { roomId, cartelaNumber },
            lock: { mode: 'pessimistic_write' },
          });
          if (!card) {
            throw new BadRequestException(`Cartela #${cartelaNumber} does not exist in this room`);
          }
          if (card.assignedTicketId) {
            throw new ConflictException(`Cartela #${cartelaNumber} is already taken`);
          }

          const ticket = manager.create(BingoTicket, {
            userId,
            roomId,
            agentId: room.ownerAgentId ?? null, // per-agent settlement snapshot
            cartelaNumber,
            cardId: card.id,
            // Immutable snapshot of the assigned pool card — settlement/winner
            // logic keeps reading ticket.grid unchanged.
            grid: card.grid,
            markedNumbers: [],
            completedLines: [],
            wonTiers: [],
            completedPatterns: [],
            stakeMinor: room.ticketPriceMinor,
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            purchaseIdempotencyKey: input.idempotencyKey,
            walletCredits: [],
          });

          await manager.save(ticket);

          // Mark the pool card as assigned so it can never be handed out again.
          card.assignedTicketId = ticket.id;
          card.assignedUserId = userId;
          await manager.save(card);

          const walletDebit = await this.walletService.debitInSession(
            {
              userId: input.userId,
              amountMinor: room.ticketPriceMinor,
              entryType: 'stake',
              sourceType: 'bingo_ticket',
              sourceId: ticket.id,
              idempotencyKey: `bingo-ticket:${input.idempotencyKey}:${index}`,
              metadata: { roomId: room.id, cartelaNumber },
            },
            manager,
          );

          ticket.walletDebit = walletDebit;
          await manager.save(ticket);
          createdTickets.push(ticket);
        }

        const wasEmpty = room.soldTickets === 0;
        room.soldTickets += cartelaNumbers.length;
        this.startCountdownOnFirstSale(room, cfg, wasEmpty);
        await manager.save(room);

        return createdTickets.map((ticket) => this.toTicketResponse(ticket));
      }

      // ── Line / Pattern mode: buy N random cards ──────────────────────────────
      const count = input.count ?? 1;
      if (!Number.isSafeInteger(count) || count < 1 || count > 24) {
        throw new BadRequestException('Bingo ticket count must be between 1 and 24');
      }
      if (room.soldTickets + count > room.maxTickets) {
        throw new ConflictException('Bingo room is full for ticket sales');
      }

      const wasEmpty = room.soldTickets === 0;
      room.soldTickets += count;
      this.startCountdownOnFirstSale(room, cfg, wasEmpty);
      await manager.save(room);

      const createdTickets: BingoTicket[] = [];
      for (let index = 0; index < count; index += 1) {
        const isPatternMode = room.winMode === 'pattern';
        const useSelection = index === 0 && input.selectedNumbers && input.selectedNumbers.length > 0;
        const grid = useSelection
          ? (isPatternMode
              ? this.bingoRulesService.generatePatternCardFromSelection(input.selectedNumbers!, room.numberRange ?? 75)
              : this.bingoRulesService.generateTicketFromSelection(input.selectedNumbers!))
          : (isPatternMode
              ? this.bingoRulesService.generatePatternCard(room.numberRange ?? 75)
              : this.bingoRulesService.generateTicket());

        const ticket = manager.create(BingoTicket, {
          userId,
          roomId,
          agentId: room.ownerAgentId ?? null, // per-agent settlement snapshot
          grid,
          markedNumbers: [],
          completedLines: [],
          wonTiers: [],
          completedPatterns: [],
          stakeMinor: room.ticketPriceMinor,
          payoutMinor: 0,
          status: 'active',
          settlementStatus: 'pending',
          purchaseIdempotencyKey: input.idempotencyKey,
          walletCredits: [],
        });

        await manager.save(ticket);

        const walletDebit = await this.walletService.debitInSession(
          {
            userId: input.userId,
            amountMinor: room.ticketPriceMinor,
            entryType: 'stake',
            sourceType: 'bingo_ticket',
            sourceId: ticket.id,
            idempotencyKey: `bingo-ticket:${input.idempotencyKey}:${index}`,
            metadata: { roomId: room.id, ticketIndex: index },
          },
          manager,
        );

        ticket.walletDebit = walletDebit;
        await manager.save(ticket);
        createdTickets.push(ticket);
      }

      return createdTickets.map((ticket) => this.toTicketResponse(ticket));
    });
  }

  /**
   * Release a derash cartela the caller owns and refund its stake. Only allowed
   * while the room is still `open` (sales window). Frees the pool card so the
   * cartela can be bought again, refunds the stake with a `refund` ledger entry in
   * the same transaction, and decrements the sold counter. Idempotent per ticket:
   * the refund idempotency key guarantees a double-tap cannot double-credit.
   */
  async releaseCartela(input: {
    userId: string;
    roomId: string;
    cartelaNumber: number;
  }): Promise<{ cartelaNumber: number; refundedMinor: number }> {
    const userId = this.validateUuid(input.userId, 'userId');
    const roomId = this.validateUuid(input.roomId, 'roomId');

    return await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(BingoRoom, {
        where: { id: roomId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!room) throw new NotFoundException('Bingo room not found');
      if (room.winMode !== 'prefilled') {
        throw new BadRequestException('Cartela refunds apply to derash rooms only');
      }
      if (room.status !== 'open') {
        throw new ConflictException('Sales are closed — this cartela can no longer be refunded');
      }
      if (room.scheduledStartAt && room.scheduledStartAt.getTime() - Date.now() <= FINAL_CARTELA_RETURN_LOCK_MS) {
        throw new ConflictException('Cartela returns are locked in the final 3 seconds before the draw');
      }

      const ticket = await manager.findOne(BingoTicket, {
        where: { roomId, userId, cartelaNumber: input.cartelaNumber, status: 'active' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) {
        throw new NotFoundException('You do not hold an active cartela with that number in this room');
      }

      const refundCredit = await this.walletService.creditInSession(
        {
          userId,
          amountMinor: ticket.stakeMinor,
          entryType: 'refund',
          sourceType: 'bingo_ticket',
          sourceId: ticket.id,
          idempotencyKey: `bingo-cartela-refund:${ticket.id}`,
          metadata: { roomId, cartelaNumber: input.cartelaNumber, reason: 'cartela_released' },
        },
        manager,
      );

      ticket.status = 'cancelled';
      ticket.settlementStatus = 'settled';
      ticket.walletCredits = [...(ticket.walletCredits ?? []), refundCredit];
      await manager.save(ticket);

      // Free the pool card so the cartela number returns to the available set.
      if (ticket.cardId) {
        await manager.update(BingoCard, { id: ticket.cardId }, { assignedTicketId: null, assignedUserId: null });
      } else {
        await manager.update(
          BingoCard,
          { roomId, cartelaNumber: input.cartelaNumber },
          { assignedTicketId: null, assignedUserId: null },
        );
      }

      room.soldTickets = Math.max(0, room.soldTickets - 1);
      await manager.save(room);

      const realPlayersRemaining = await this.countRealPlayersInRoom(room.id, manager);
      if (realPlayersRemaining === 0) {
        await this.cancelRoomWithRefundsInSession(room, manager, 'bingo_room_no_real_players');
      }

      return { cartelaNumber: input.cartelaNumber, refundedMinor: ticket.stakeMinor };
    });
  }

  // ── Draw ─────────────────────────────────────────────────────────────────────

  async drawNextNumber(roomId: string): Promise<BingoRoomResponse> {
    const validRoomId = this.validateUuid(roomId, 'roomId');
    const cfg = await this.getBingoConfig();
    const minDrawsBeforeWin = cfg.minDrawsBeforeWin ?? 0;

    return await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(BingoRoom, {
        where: { id: validRoomId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!room) throw new NotFoundException('Bingo room not found');

      if (room.status === 'completed' || room.status === 'cancelled') {
        const soldTickets = await this.countSoldTickets(validRoomId, manager);
        const takenSpots = room.winMode === 'prefilled' ? await this.getTakenSpots(validRoomId) : undefined;
        return this.toRoomResponse(room, soldTickets, takenSpots);
      }

      // Empty-round cleanup: a RUNNING room with no tickets sold — e.g. a legacy
      // room that began before the "idle until first ticket" guard existed — is
      // cancelled QUIETLY (no completion event, no "no players" result overlay)
      // instead of drawing out an empty game. New rooms can't reach here: they only
      // start via findRoomsToStart, which requires soldTickets > 0.
      if (room.status === 'running' && (await this.countSoldTickets(validRoomId, manager)) === 0) {
        room.status = 'cancelled';
        room.activeGuard = null;
        await manager.save(room);
        this.logger.warn(`Cancelled empty running Bingo room ${validRoomId} (no tickets sold)`);
        const takenSpots = room.winMode === 'prefilled' ? await this.getTakenSpots(validRoomId) : undefined;
        return this.toRoomResponse(room, 0, takenSpots);
      }

      if (room.status === 'open') {
        const currentSoldTickets = await this.countSoldTickets(validRoomId, manager);
        const takenSpots = room.winMode === 'prefilled' ? await this.getTakenSpots(validRoomId) : undefined;
        if (currentSoldTickets <= 0) {
          return this.toRoomResponse(room, currentSoldTickets, takenSpots);
        }

        const realPlayers = await this.countRealPlayersInRoom(validRoomId, manager);
        if (realPlayers <= 0) {
          await this.cancelRoomWithRefundsInSession(room, manager, 'bingo_room_no_real_players');
          this.logger.warn(`Cancelled Bingo room ${validRoomId} before start because no real players remained`);
          return this.toRoomResponse(room, 0, takenSpots);
        }
      }

      // Ball pool drawn from: line is fixed 90-ball, derash is fixed 75-ball
      // (standard B/I/N/G/O), pattern uses the room's configured range. Forcing
      // 75 for derash here means even a legacy/misconfigured room can NEVER call a
      // number above 75 (no more 137/200 balls). gridSize is the cartela count.
      const maxNumber = room.winMode === 'line' ? 90 : room.winMode === 'prefilled' ? 75 : (room.numberRange ?? 75);

      // All numbers drawn but room still running — complete it.
      if (room.drawnNumbers.length >= maxNumber) {
        const soldTickets = await this.countSoldTickets(validRoomId, manager);
        if (soldTickets > 0) {
          if (room.winMode === 'prefilled') {
            // All balls drawn → resolve the room. Leaderboard mode ranks the whole
            // queue at once; race mode fills any still-open places then reconciles.
            if (room.rankingMode === 'leaderboard') {
              await this.settleDerashLeaderboard(room, cfg, manager);
            } else {
              await this.evaluateAndSettleDerash(room, cfg, manager);
              await this.reconcileDerashPool(room, cfg, manager);
            }
          } else if (room.winMode === 'pattern') {
            const patternIds = (room.patternPrizes ?? []).map((pp) => pp.patternId);
            const patterns =
              patternIds.length > 0
                ? await manager.find(BingoPattern, { where: { id: In(patternIds) } })
                : [];
            await this.evaluateAndSettlePatterns(room, patterns, manager);
            await this.markRemainingTicketsLost(room, manager);
          } else {
            await this.evaluateAndSettleTiers(room, manager);
            await this.markRemainingTicketsLost(room, manager);
          }
        }
        room.status = 'completed';
        // Release the active-game slot so the next room can be created.
        await manager.query(
          `UPDATE bingo_rooms SET status = 'completed', activeGuard = NULL, settledTiers = ?, winnersByTier = ?, settlementSummary = ? WHERE id = ?`,
          [
            JSON.stringify(room.settledTiers),
            JSON.stringify(room.winnersByTier),
            JSON.stringify(room.settlementSummary ?? null),
            validRoomId,
          ],
        );
        const takenSpots = room.winMode === 'prefilled' ? await this.getTakenSpots(validRoomId) : undefined;
        return this.toRoomResponse(room, soldTickets, takenSpots);
      }

      room.status = 'running';
      const remainingNumbers = Array.from({ length: maxNumber }, (_, i) => i + 1).filter(
        (n) => !room.drawnNumbers.includes(n),
      );

      const rngResult = await this.rngService.drawUniqueNumbers({
        min: 1,
        max: remainingNumbers.length,
        count: 1,
        gameType: 'bingo',
        gameReference: `${room.id}:${room.drawnNumbers.length + 1}`,
        metadata: { roomId: room.id, remainingNumbers },
        manager,
      });

      const drawnNumber = remainingNumbers[rngResult.numbers[0] - 1];
      room.drawnNumbers = [...room.drawnNumbers, drawnNumber];
      if (rngResult.auditLogId) room.rngAuditLogIds = [...room.rngAuditLogIds, rngResult.auditLogId];

      if (room.winMode === 'prefilled') {
        if (room.rankingMode === 'leaderboard') {
          await this.progressDerashLeaderboard(room, cfg, maxNumber, minDrawsBeforeWin, manager);
        } else {
          if (room.drawnNumbers.length >= minDrawsBeforeWin) {
            await this.evaluateAndSettleDerash(room, cfg, manager);
          }
          await this.finalizeDerashIfDone(room, cfg, maxNumber, manager);
        }
      } else if (room.winMode === 'pattern') {
        const patternIds = (room.patternPrizes ?? []).map((pp) => pp.patternId);
        const patterns =
          patternIds.length > 0
            ? await manager.find(BingoPattern, { where: { id: In(patternIds) } })
            : [];

        if (room.drawnNumbers.length >= minDrawsBeforeWin) {
          await this.evaluateAndSettlePatterns(room, patterns, manager);
        }

        const allSettled =
          patternIds.length > 0 && patternIds.every((pid) => room.settledTiers.includes(pid));
        if (allSettled || room.drawnNumbers.length >= maxNumber) {
          room.status = 'completed';
          await this.markRemainingTicketsLost(room, manager);
        }
      } else {
        if (room.drawnNumbers.length >= minDrawsBeforeWin) {
          await this.evaluateAndSettleTiers(room, manager);
        }
        if (room.settledTiers.includes('full_house') || room.drawnNumbers.length >= maxNumber) {
          room.status = 'completed';
          await this.markRemainingTicketsLost(room, manager);
        }
      }

      // Release the active-game slot once the game is over so the next room
      // can claim it (NULL is exempt from the unique index).
      if (room.status === 'completed') room.activeGuard = null;

      await manager.save(room);
      const soldTickets = await this.countSoldTickets(validRoomId, manager);
      const takenSpots = room.winMode === 'prefilled' ? await this.getTakenSpots(validRoomId) : undefined;
      return this.toRoomResponse(room, soldTickets, takenSpots);
    });
  }

  // ── Cancel ───────────────────────────────────────────────────────────────────

  async cancelRoom(roomId: string): Promise<BingoRoomResponse> {
    const validRoomId = this.validateUuid(roomId, 'roomId');

    return await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(BingoRoom, {
        where: { id: validRoomId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!room) throw new NotFoundException('Bingo room not found');
      if (room.status === 'completed') {
        throw new ConflictException('Completed Bingo rooms cannot be cancelled');
      }
      if (room.status === 'cancelled') {
        const soldTickets = await this.countSoldTickets(validRoomId, manager);
        return this.toRoomResponse(room, soldTickets);
      }

      await this.cancelRoomWithRefundsInSession(room, manager, 'bingo_room_cancelled');
      return this.toRoomResponse(room, 0);
    });
  }

  // ── Private settlement helpers ────────────────────────────────────────────────

  /**
   * Derash settlement. Each cartela is a mapped 5×5 card; a card wins a place by
   * completing THAT place's configured winning pattern (places may each require a
   * different pattern — e.g. 1st = Any Line, 2nd = Any Two Lines, 3rd = L Shape).
   * On every draw all active cards are re-marked, then each still-open place
   * (1st → 2nd → 3rd → 4th → 5th, only the enabled ones) is awarded to the
   * earliest-purchased active card that completes that place's pattern — one card
   * per place, one place per card. When only 1st is enabled there is exactly one
   * winner and the room ends. Each place pays a configured % of the pot.
   */
  private async evaluateAndSettleDerash(
    room: BingoRoom,
    cfg: BingoConfig,
    manager: EntityManager,
  ): Promise<void> {
    // In-play cards = still eligible to win. NON-EXCLUSIVE model: a card that has
    // already won a (lower) place stays in the running for higher places, so we
    // include `won` cards, not just `active` ones. This is why the strongest card
    // is never locked out of the jackpot — winning the one-line tier does not
    // remove it from the three-line tier.
    const inPlayTickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: In(['active', 'won']) },
      order: { createdAt: 'ASC' },
    });
    if (inPlayTickets.length === 0) return;

    // Re-mark every in-play card against the current draw (marking is independent
    // of any win pattern, so cards light up as numbers are called).
    const drawn = new Set(room.drawnNumbers);
    for (const ticket of inPlayTickets) {
      ticket.markedNumbers = ticket.grid
        .flat()
        .filter((v): v is number => v !== null && drawn.has(v))
        .sort((a, b) => a - b);
      await manager.save(ticket);
    }

    // Pot from the live, non-cancelled ticket rows — never the room.soldTickets
    // counter — so the settled pot always equals the advertised pot.
    const soldTickets = await this.countSoldTickets(room.id, manager);
    const totalPotMinor = soldTickets * room.ticketPriceMinor;
    const houseEdgePct = room.houseEdgePct ?? 20;

    // Bot win-steering (house liquidity). While a room has fewer than
    // botMaxRealPlayers REAL players, guaranteed/hybrid/cartel-dual modes redirect
    // a real user's win to a bot. `statistical`/`off` never redirect here —
    // statistical relies purely on bots holding most cartelas (a fair draw).
    const botIds = await this.getActiveBotUserIds(manager);
    const realPlayers = await this.countRealPlayersInRoom(room.id, manager);
    const belowThreshold =
      (cfg.botMaxRealPlayers ?? 0) > 0 && realPlayers < (cfg.botMaxRealPlayers ?? 0);
    const redirectRealWinsToBot =
      belowThreshold &&
      (cfg.botWinMode === 'guaranteed' || cfg.botWinMode === 'hybrid' || cfg.botWinMode === 'cartel-dual');

    // Parse alias pool once for this draw — used by alias rotation helper below.
    let aliasPool: string[] = [];
    try {
      if (cfg.botAliasPool) aliasPool = JSON.parse(cfg.botAliasPool);
    } catch { /* malformed JSON — fall back to displayName */ }

    // Track which alias index has been used this round so dual-cartel 1st and 2nd
    // place always get DIFFERENT names.
    let aliasIndexOffset = 0;

    // Each ENABLED, still-open place is an INDEPENDENT "first card to complete this
    // place's pattern" race, evaluated every draw. Independent → not blocked by an
    // earlier unfilled place (so with 1st=Any Three Lines / 3rd=Any Line, 3rd fills
    // on the first single line, 1st on the first three lines — progressive reveal).
    // Non-exclusive → the same card may win several places over the game (it just
    // can't win the same place twice). Prizes here are the progressive lower bound
    // (weight / enabled-total); the pool is topped up to weight / FILLED-total at
    // completion by reconcileDerashPool, so unfilled places never leak to the house.
    for (const place of this.openPrefilledPlaces(room, cfg)) {
      const pattern = await this.resolvePrefilledPlacePattern(cfg, place, manager);
      if (!pattern) continue;

      const winner = inPlayTickets.find(
        (t) =>
          // Manual-mode cards (owner turned Auto OFF) are never auto-awarded —
          // they can only win via an explicit "Bingo" claim (claimBingo).
          t.autoClaim !== false &&
          this.bingoRulesService
            .evaluatePatternTicket(t.grid, room.drawnNumbers, [pattern])
            .completedPatternIds.includes(pattern.id),
      );
      // No eligible card completes THIS place's pattern yet — try the next place;
      // a later draw may fill this one.
      if (!winner) continue;

      // House-retention redirect: if the natural winner is a REAL player and the
      // mode calls for it, hand the place to a bot instead (prefer a bot whose
      // card also completes the pattern so the revealed winner looks legitimate).
      let awardee = winner;
      let overrideDisplayName: string | undefined;

      if (redirectRealWinsToBot && !botIds.has(winner.userId)) {
        const botAwardee = this.pickBotRedirectWinner(inPlayTickets, botIds, pattern, room.drawnNumbers);
        if (botAwardee) {
          awardee = botAwardee;
          // Alias rotation: cartel-dual uses a different alias per place so
          // 1st and 2nd look like two unrelated real players.
          if (aliasPool.length > 0) {
            const idx = (this.hashRoomIdToInt(room.id) + aliasIndexOffset) % aliasPool.length;
            overrideDisplayName = aliasPool[idx];
            aliasIndexOffset += 1; // next place gets a different alias
          }
          this.logger.log(
            `Bot win-steer (${cfg.botWinMode}): room ${room.id} place ${place} redirected from real user ${winner.userId} to bot ${botAwardee.userId}${overrideDisplayName ? ` as "${overrideDisplayName}"` : ''}`,
          );
        }
      }

      await this.awardDerashPlace({ room, winner: awardee, place, pattern, totalPotMinor, houseEdgePct, cfg, manager, overrideDisplayName });
    }


    // ── House-win for disqualified cards ─────────────────────────────────────────
    // A card disqualified for a premature "Bingo" call still races for the win. For
    // any place STILL open after the honest cards had their chance this draw, if a
    // pending-disqualified card completes the pattern it was the (first) winning
    // card — but the false call voids the payout, so the HOUSE takes the prize and
    // we record the forfeit on the card + room summary for audit ("why wasn't I
    // paid?"). Honest cards are evaluated first (above), so a legit card completing
    // the same draw always beats the house claim.
    const pendingDq = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: 'disqualified', settlementStatus: 'pending' },
      order: { createdAt: 'ASC' },
    });
    if (pendingDq.length > 0) {
      for (const dq of pendingDq) {
        dq.markedNumbers = dq.grid
          .flat()
          .filter((v): v is number => v !== null && drawn.has(v))
          .sort((a, b) => a - b);
      }
      for (const place of this.openPrefilledPlaces(room, cfg)) {
        const pattern = await this.resolvePrefilledPlacePattern(cfg, place, manager);
        if (!pattern) continue;
        const dqWinner = pendingDq.find((t) =>
          this.bingoRulesService
            .evaluatePatternTicket(t.grid, room.drawnNumbers, [pattern])
            .completedPatternIds.includes(pattern.id),
        );
        if (!dqWinner) continue;
        await this.awardDerashPlaceToHouse({
          room,
          dqTicket: dqWinner,
          place,
          pattern,
          totalPotMinor,
          houseEdgePct,
          cfg,
          manager,
        });
      }
    }
  }

  /**
   * Leaderboard mode per-draw progression. Nobody is paid during play; the room
   * simply runs until a card completes the **1st-place pattern** (or the ball pool
   * is exhausted, or no cards remain), then the whole queue is settled at once by
   * `settleDerashLeaderboard`. Cards are re-marked every draw so the UI stays live.
   */
  private async progressDerashLeaderboard(
    room: BingoRoom,
    cfg: BingoConfig,
    maxNumber: number,
    minDrawsBeforeWin: number,
    manager: EntityManager,
  ): Promise<void> {
    const inPlay = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: In(['active', 'won']) },
      order: { createdAt: 'ASC' },
    });

    // Re-mark every in-play card so boards/cartelas light up as numbers are called.
    const drawn = new Set(room.drawnNumbers);
    for (const ticket of inPlay) {
      ticket.markedNumbers = ticket.grid
        .flat()
        .filter((v): v is number => v !== null && drawn.has(v))
        .sort((a, b) => a - b);
      await manager.save(ticket);
    }

    // Nothing left to play for → close and reconcile (refunds if truly empty).
    if (inPlay.length === 0) {
      room.status = 'completed';
      room.activeGuard = null;
      await this.reconcileDerashPool(room, cfg, manager);
      return;
    }

    let ended = room.drawnNumbers.length >= maxNumber;
    if (!ended && room.drawnNumbers.length >= minDrawsBeforeWin) {
      const firstPattern = await this.resolvePrefilledPlacePattern(cfg, '1st', manager);
      if (firstPattern) {
        ended = inPlay.some((t) =>
          this.bingoRulesService
            .evaluatePatternTicket(t.grid, room.drawnNumbers, [firstPattern])
            .completedPatternIds.includes(firstPattern.id),
        );
      }
    }

    if (ended) {
      await this.settleDerashLeaderboard(room, cfg, manager);
      room.status = 'completed';
      room.activeGuard = null;
    }
  }

  /**
   * Leaderboard settlement — called once at round end. Builds a queue of cards
   * ordered by the **hardest place-pattern each completed** (1st is hardest), ties
   * broken by **who reached that pattern first**, then assigns ranks by POSITION:
   * queue #1 → 1st, #2 → 2nd, … through the enabled places. A card can be promoted
   * into a higher empty slot than the pattern it actually completed. Cards that
   * completed no pattern are unranked (win nothing). Reuses `awardDerashPlace` +
   * `reconcileDerashPool`, so the money math is identical to race mode.
   */
  private async settleDerashLeaderboard(
    room: BingoRoom,
    cfg: BingoConfig,
    manager: EntityManager,
  ): Promise<void> {
    const inPlay = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: In(['active', 'won']) },
      order: { createdAt: 'ASC' },
    });
    if (inPlay.length === 0) return;

    const drawnSet = new Set(room.drawnNumbers);
    for (const ticket of inPlay) {
      ticket.markedNumbers = ticket.grid
        .flat()
        .filter((v): v is number => v !== null && drawnSet.has(v))
        .sort((a, b) => a - b);
      await manager.save(ticket);
    }

    // Enabled places in order 1st→…→5th (hardest→easiest by convention). Nothing is
    // settled yet in leaderboard mode, so this is the full enabled list.
    const places = this.openPrefilledPlaces(room, cfg);
    if (places.length === 0) return;

    const placePattern = new Map<PrefilledPlace, BingoPattern>();
    for (const place of places) {
      const pattern = await this.resolvePrefilledPlacePattern(cfg, place, manager);
      if (pattern) placePattern.set(place, pattern);
    }
    if (placePattern.size === 0) return;

    // Rank the queue with the exact pure logic the leaderboard spec tests. `key`
    // is the index into `inPlay` so we can map a rank back to its ticket.
    const ranked = rankDerashLeaderboard(
      this.bingoRulesService,
      inPlay.map((ticket, i) => ({ key: i, grid: ticket.grid, order: i })),
      room.drawnNumbers,
      places,
      placePattern,
    );

    const soldTickets = await this.countSoldTickets(room.id, manager);
    const totalPotMinor = soldTickets * room.ticketPriceMinor;
    const houseEdgePct = room.houseEdgePct ?? 20;

    // Assign ranks strictly by queue position, capped at the enabled place count.
    for (let i = 0; i < ranked.length && i < places.length; i++) {
      const place = places[i];
      const pattern = placePattern.get(place);
      if (!pattern) continue;
      await this.awardDerashPlace({
        room,
        winner: inPlay[ranked[i].key],
        place,
        pattern,
        totalPotMinor,
        houseEdgePct,
        cfg,
        manager,
      });
    }

    // Top up filled places to share the whole pool and mark non-winners lost.
    await this.reconcileDerashPool(room, cfg, manager);
  }

  /** Enabled derash places (1st always) that are not yet settled, in place order. */
  private openPrefilledPlaces(room: BingoRoom, cfg: BingoConfig): PrefilledPlace[] {
    const enabled: Record<PrefilledPlace, boolean> = {
      '1st': true,
      '2nd': !!cfg.prefilledSecondPlaceEnabled,
      '3rd': !!cfg.prefilledThirdPlaceEnabled,
      '4th': !!cfg.prefilledFourthPlaceEnabled,
      '5th': !!cfg.prefilledFifthPlaceEnabled,
    };
    return (['1st', '2nd', '3rd', '4th', '5th'] as PrefilledPlace[]).filter(
      (place) => enabled[place] && !room.settledTiers.includes(place),
    );
  }

  /**
   * Award a single derash place to a winning card: pays the place's prize into
   * the winner's wallet (with an idempotent ledger credit), flips the ticket to
   * `won`/`settled`, and records the winner on the room so every client can
   * render the result. Shared by the settlement tick (auto) and the manual
   * "Bingo" claim (claimBingo) so both paths pay identically.
   */
  private async awardDerashPlace(input: {
    room: BingoRoom;
    winner: BingoTicket;
    place: PrefilledPlace;
    pattern: BingoPattern;
    totalPotMinor: number;
    houseEdgePct: number;
    cfg: BingoConfig;
    manager: EntityManager;
    /** Optional alias to display instead of the bot's real displayName. */
    overrideDisplayName?: string;
  }): Promise<void> {
    const { room, winner, place, pattern, totalPotMinor, houseEdgePct, cfg, manager, overrideDisplayName } = input;
    const prizePoolMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));
    const prizeMinor = this.computePrefilledPrizeMinor(totalPotMinor, place, houseEdgePct, cfg);
    const winnerUser = await manager.findOne(User, {
      where: { id: winner.userId },
      select: ['displayName', 'phoneNumber', 'productMetadata'],
    });
    const display = winnerUser
      ? await this.resolveDisplayedNameForUser(room, winnerUser, manager)
      : { displayName: 'Player', phoneLast4: '', phoneSuffix: undefined, isBot: false };
    const displayedName = overrideDisplayName
      ? (display.phoneSuffix ? this.formatBotDisplayName(overrideDisplayName, display.phoneSuffix) : overrideDisplayName)
      : display.displayName;
    const phoneLast4 = overrideDisplayName ? '' : display.phoneLast4;

    winner.wonTiers = [...(winner.wonTiers ?? []), place];
    winner.payoutMinor += prizeMinor;
    winner.status = 'won';
    winner.settlementStatus = 'settled';

    if (prizeMinor > 0) {
      const winCredit = await this.walletService.creditInSession(
        {
          userId: winner.userId,
          amountMinor: prizeMinor,
          entryType: 'win',
          sourceType: 'bingo_ticket',
          sourceId: winner.id,
          idempotencyKey: `bingo-settlement:${place}:${winner.id}`,
          metadata: {
            roomId: room.id,
            place,
            cartelaNumber: winner.cartelaNumber,
            patternId: pattern.id,
            totalPotMinor,
            prizePoolMinor,
            displayName: displayedName,
          },
        },
        manager,
      );
      winner.walletCredits = [...(winner.walletCredits ?? []), winCredit];
    }

    await manager.save(winner);

    room.settledTiers = [...room.settledTiers, place];
    room.winnersByTier = { ...room.winnersByTier, [place]: [winner.id] };
    room.settlementSummary = {
      ...room.settlementSummary,
      [place]: {
        winnerCount: 1,
        winnerId: winner.id,
        winnerDisplayName: displayedName,
        winnerPhoneLast4: phoneLast4,
        winnerIsBot: display.isBot,
        winnerCartelaNumber: winner.cartelaNumber,
        // Winner card so every client in the room can render the result.
        winnerGrid: winner.grid,
        winnerMarkedNumbers: winner.markedNumbers,
        patternName: pattern.name,
        prizeMinor,
        totalPotMinor,
        prizePoolMinor,
      },
    };
  }

  /**
   * Award a derash place to the HOUSE because the (first) card to complete it was
   * DISQUALIFIED for a premature "Bingo" call. No wallet is credited — the prize is
   * retained by the house. The card is stamped with the forfeited amount + place
   * (audit), and the room summary records the disqualified winning card (grid,
   * cartela, owner, `disqualified`/`houseWon` flags) so every client renders the
   * reveal flagged "disqualified" and support can later explain the non-payment.
   * The place is CLOSED — no other player can win it (the winning card was this one).
   */
  private async awardDerashPlaceToHouse(input: {
    room: BingoRoom;
    dqTicket: BingoTicket;
    place: PrefilledPlace;
    pattern: BingoPattern;
    totalPotMinor: number;
    houseEdgePct: number;
    cfg: BingoConfig;
    manager: EntityManager;
  }): Promise<void> {
    const { room, dqTicket, place, pattern, totalPotMinor, houseEdgePct, cfg, manager } = input;
    const prizePoolMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));
    const forfeitedMinor = this.computePrefilledPrizeMinor(totalPotMinor, place, houseEdgePct, cfg);

    // Record the forfeit on the card — the audit trail behind the unpaid win.
    dqTicket.disqualifiedWonRound = true;
    dqTicket.forfeitedWinMinor = (dqTicket.forfeitedWinMinor ?? 0) + forfeitedMinor;
    dqTicket.forfeitedPlaces = [...(dqTicket.forfeitedPlaces ?? []), place];
    dqTicket.settlementStatus = 'settled';
    await manager.save(dqTicket);

    const dqUser = await manager.findOne(User, {
      where: { id: dqTicket.userId },
      select: ['displayName', 'phoneNumber', 'productMetadata'],
    });
    const display = dqUser
      ? await this.resolveDisplayedNameForUser(room, dqUser, manager)
      : { displayName: 'Player', phoneLast4: '', phoneSuffix: undefined, isBot: false };
    const phoneLast4 = display.phoneLast4;

    // Close the place to everyone (settled) but with NO paying winner.
    room.settledTiers = [...room.settledTiers, place];
    room.winnersByTier = { ...room.winnersByTier, [place]: [] };
    room.settlementSummary = {
      ...room.settlementSummary,
      [place]: {
        winnerCount: 0,
        disqualified: true,
        houseWon: true,
        // The disqualified winning card — shown in the reveal, flagged.
        winnerId: dqTicket.id,
        winnerUserId: dqTicket.userId,
        winnerDisplayName: display.displayName,
        winnerPhoneLast4: phoneLast4,
        winnerCartelaNumber: dqTicket.cartelaNumber,
        winnerGrid: dqTicket.grid,
        winnerMarkedNumbers: dqTicket.markedNumbers,
        patternName: pattern.name,
        // What the player forfeited = what the house kept for this place.
        prizeMinor: forfeitedMinor,
        forfeitedWinMinor: forfeitedMinor,
        disqualifiedReason: dqTicket.disqualifiedReason ?? 'premature_claim',
        totalPotMinor,
        prizePoolMinor,
      },
    };
    this.logger.log(
      `Derash house-win: room ${room.id} place ${place} — disqualified cartela #${dqTicket.cartelaNumber} ` +
        `(ticket ${dqTicket.id}, user ${dqTicket.userId}) forfeited ${forfeitedMinor} to house`,
    );
  }

  /**
   * Ends a derash room once there is nothing left to play for: every enabled place
   * is filled, the ball pool is exhausted, or literally no cards remain in play.
   * Shared by the draw tick and the manual claim so a claim that fills the last
   * place closes the game immediately. On completion it reconciles the prize pool.
   * Returns whether the room was completed.
   */
  private async finalizeDerashIfDone(
    room: BingoRoom,
    cfg: BingoConfig,
    maxNumber: number,
    manager: EntityManager,
  ): Promise<boolean> {
    const totalPlaces = 1
      + (cfg.prefilledSecondPlaceEnabled ? 1 : 0)
      + (cfg.prefilledThirdPlaceEnabled ? 1 : 0)
      + (cfg.prefilledFourthPlaceEnabled ? 1 : 0)
      + (cfg.prefilledFifthPlaceEnabled ? 1 : 0);
    // A card that has already won a lower tier is STILL in play for higher tiers
    // (non-exclusive), so "in play" counts active AND won cards. We therefore only
    // end when every enabled place is filled, the pool is exhausted, or no cards
    // remain at all (e.g. everyone was refunded) — never merely because the
    // not-yet-winning cards are gone.
    const inPlay = await manager.countBy(BingoTicket, {
      roomId: room.id,
      status: In(['active', 'won']),
    });
    // A disqualified card awaiting resolution keeps the game alive: it may still
    // complete the winning pattern and hand the prize to the house. Only end when
    // there are neither in-play cards NOR any unresolved disqualified ones.
    const pendingDq = await manager.countBy(BingoTicket, {
      roomId: room.id,
      status: 'disqualified',
      settlementStatus: 'pending',
    });
    if (
      room.settledTiers.length >= totalPlaces ||
      (inPlay === 0 && pendingDq === 0) ||
      room.drawnNumbers.length >= maxNumber
    ) {
      room.status = 'completed';
      room.activeGuard = null;
      await this.reconcileDerashPool(room, cfg, manager);
      return true;
    }
    return false;
  }

  /** The derash place keys, hardest→easiest by convention (1st is the top prize). */
  private static readonly PREFILLED_PLACE_KEYS: PrefilledPlace[] = ['1st', '2nd', '3rd', '4th', '5th'];

  /**
   * Final money settlement for a completed derash room. Distributes the WHOLE
   * house-adjusted pool across the places that were ACTUALLY filled, in proportion
   * to their configured weights (normalise by FILLED weights, not enabled). During
   * play each winner was credited the progressive lower bound
   * (weight / enabled-total); here we credit the top-up so the filled places share
   * the entire pool and the house keeps exactly its edge — no enabled-but-unfilled
   * share is silently retained. If NO place filled (nobody completed even the
   * easiest pattern — only possible in a degenerate/empty room), every in-play
   * stake is refunded. Finally, cards that won nothing are marked lost.
   */
  private async reconcileDerashPool(
    room: BingoRoom,
    cfg: BingoConfig,
    manager: EntityManager,
  ): Promise<void> {
    const filledPlaces = BingoService.PREFILLED_PLACE_KEYS.filter((p) => room.settledTiers.includes(p));

    // Resolve any disqualified card that never became the house-winner so it stops
    // keeping the game alive. It stays 'disqualified' for audit (never flipped to
    // 'lost', never refunded — a false call forfeits the stake).
    await manager.update(
      BingoTicket,
      { roomId: room.id, status: 'disqualified', settlementStatus: 'pending' },
      { settlementStatus: 'settled' },
    );

    if (filledPlaces.length === 0) {
      // No winner at all — refund every in-play stake (house takes nothing when
      // there was no outcome), then there is nothing left to mark lost.
      await this.refundInPlayDerashTickets(room, manager);
      return;
    }

    const soldTickets = await this.countSoldTickets(room.id, manager);
    const totalPotMinor = soldTickets * room.ticketPriceMinor;
    const houseEdgePct = room.houseEdgePct ?? 20;

    for (const place of filledPlaces) {
      // Final = the place's share of the whole pool among the FILLED places.
      // Progressive = what awardDerashPlace already credited (weight / enabled).
      const finalPrize = this.computePrefilledFinalPrizeMinor(totalPotMinor, place, houseEdgePct, filledPlaces, cfg);
      const progressivePrize = this.computePrefilledPrizeMinor(totalPotMinor, place, houseEdgePct, cfg);
      const topUpMinor = finalPrize - progressivePrize;

      // Reflect the FINAL amount in the summary the clients read at completion.
      this.setDerashSummaryPrize(room, place, finalPrize);

      const winnerId = room.winnersByTier[place]?.[0];
      if (!winnerId || topUpMinor <= 0) continue;

      const ticket = await manager.findOne(BingoTicket, { where: { id: winnerId } });
      if (!ticket) continue;

      const topUpCredit = await this.walletService.creditInSession(
        {
          userId: ticket.userId,
          amountMinor: topUpMinor,
          entryType: 'win',
          sourceType: 'bingo_ticket',
          sourceId: ticket.id,
          idempotencyKey: `bingo-reconcile:${place}:${ticket.id}`,
          metadata: {
            roomId: room.id,
            place,
            kind: 'pool_redistribution',
            progressivePrizeMinor: progressivePrize,
            finalPrizeMinor: finalPrize,
          },
        },
        manager,
      );
      ticket.payoutMinor += topUpMinor;
      ticket.walletCredits = [...(ticket.walletCredits ?? []), topUpCredit];
      await manager.save(ticket);
    }

    // Cards that never won any place → lost (won cards keep their 'won' status).
    await this.markRemainingTicketsLost(room, manager);
  }

  /** Overwrite a place's prizeMinor in the settlement summary (final reconciled value). */
  private setDerashSummaryPrize(room: BingoRoom, place: PrefilledPlace, prizeMinor: number): void {
    const entry = (room.settlementSummary ?? {})[place] as Record<string, unknown> | undefined;
    if (!entry) return;
    room.settlementSummary = {
      ...room.settlementSummary,
      [place]: { ...entry, prizeMinor },
    };
  }

  /** Refund every still-in-play cartela's stake — used when a room ends with no winner. */
  private async refundInPlayDerashTickets(room: BingoRoom, manager: EntityManager): Promise<void> {
    const tickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: In(['active', 'won']) },
    });
    for (const ticket of tickets) {
      const refundCredit = await this.walletService.creditInSession(
        {
          userId: ticket.userId,
          amountMinor: ticket.stakeMinor,
          entryType: 'refund',
          sourceType: 'bingo_ticket',
          sourceId: ticket.id,
          idempotencyKey: `bingo-noresult-refund:${ticket.id}`,
          metadata: { roomId: room.id, reason: 'derash_no_winner' },
        },
        manager,
      );
      ticket.status = 'cancelled';
      ticket.settlementStatus = 'settled';
      ticket.walletCredits = [...(ticket.walletCredits ?? []), refundCredit];
      await manager.save(ticket);
    }
  }

  /**
   * Manual "Bingo" claim (derash only). When a player has turned Auto OFF their
   * cards are skipped by the settlement tick, so they must tap "Bingo" on a card
   * to win — racing the tick and every other player for the next open place.
   *
   * Outcomes (see the auto-toggle feature): the room row is locked FOR UPDATE so
   * this races the draw tick and other claims deterministically —
   *  - `won`         — the card completes the next open place's pattern and gets it.
   *  - `disqualified` — the card DID complete a winning pattern but the place was
   *                     already awarded to someone else (they were too slow).
   *  - `ignored`      — the card has no bingo yet (a harmless early tap).
   */
  async claimBingo(input: {
    userId: string;
    roomId: string;
    ticketId: string;
  }): Promise<{ result: 'won' | 'disqualified' | 'ignored'; ticket: BingoTicketResponse; room: BingoRoomResponse }> {
    const userId = this.validateUuid(input.userId, 'userId');
    const roomId = this.validateUuid(input.roomId, 'roomId');
    const ticketId = this.validateUuid(input.ticketId, 'ticketId');
    const cfg = await this.getBingoConfig();

    return await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(BingoRoom, {
        where: { id: roomId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!room) throw new NotFoundException('Bingo room not found');
      if (room.winMode !== 'prefilled') {
        throw new BadRequestException('Manual Bingo claims are only available in derash rooms');
      }
      if (room.status !== 'running') {
        throw new ConflictException('Bingo can only be called while the game is drawing');
      }

      const ticket = await manager.findOne(BingoTicket, {
        where: { id: ticketId, roomId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException('Cartela not found for this player in this room');

      const finish = async (result: 'won' | 'disqualified' | 'ignored') => {
        const soldTickets = await this.countSoldTickets(roomId, manager);
        const takenSpots = await this.getTakenSpots(roomId);
        return {
          result,
          ticket: this.toTicketResponse(ticket),
          room: this.toRoomResponse(room, soldTickets, takenSpots),
        };
      };

      // In-play = can still claim. A card that already won a lower tier stays
      // eligible for higher tiers (non-exclusive), so 'won' is claimable too.
      if (ticket.status !== 'active' && ticket.status !== 'won') return finish('ignored');

      // Refresh this card's marks against the current draw before evaluating.
      const drawn = new Set(room.drawnNumbers);
      ticket.markedNumbers = ticket.grid
        .flat()
        .filter((v): v is number => v !== null && drawn.has(v))
        .sort((a, b) => a - b);

      const completesPattern = (pattern: BingoPattern | null): boolean =>
        !!pattern &&
        this.bingoRulesService
          .evaluatePatternTicket(ticket.grid, room.drawnNumbers, [pattern])
          .completedPatternIds.includes(pattern.id);

      // Does the card complete ANY enabled winning pattern right now?
      const cardHasBingo = async (): Promise<boolean> => {
        for (const place of this.openPrefilledPlaces(room, cfg)) {
          const pattern = await this.resolvePrefilledPlacePattern(cfg, place, manager);
          if (completesPattern(pattern)) return true;
        }
        return false;
      };

      // Leaderboard mode has no per-place claiming — ranks resolve once at round
      // end by final achievement, so a VALID "Bingo" tap is a harmless no-op. But a
      // PREMATURE tap (no bingo on the card yet) is still DISQUALIFIED, exactly like
      // race mode — tapping early must be penalised. A disqualified card is excluded
      // from the end-of-round ranking (settlement queries only active/won cards).
      if (room.rankingMode === 'leaderboard') {
        if ((ticket.wonTiers ?? []).length > 0 || (await cardHasBingo())) {
          return finish('ignored');
        }
        ticket.status = 'disqualified';
        ticket.disqualifiedReason = 'premature_claim';
        ticket.disqualifiedAt = new Date();
        ticket.settlementStatus = 'settled';
        await manager.save(ticket);
        this.logger.log(`Bingo (leaderboard): disqualified premature claim on cartela ${ticket.id}`);
        return finish('disqualified');
      }

      // Claim EVERY still-open place this card qualifies for (best/hardest first).
      // Non-exclusive: one tap grabs all the tiers the card currently completes and
      // that no one has taken yet — e.g. a card with three lines claims 1st (and
      // 2nd/3rd too if they are somehow still open).
      let awardedAny = false;
      for (const place of this.openPrefilledPlaces(room, cfg)) {
        const pattern = await this.resolvePrefilledPlacePattern(cfg, place, manager);
        if (!completesPattern(pattern)) continue;
        const soldTickets = await this.countSoldTickets(roomId, manager);
        const totalPotMinor = soldTickets * room.ticketPriceMinor;
        const houseEdgePct = room.houseEdgePct ?? 20;
        await this.awardDerashPlace({
          room,
          winner: ticket,
          place,
          pattern: pattern as BingoPattern,
          totalPotMinor,
          houseEdgePct,
          cfg,
          manager,
        });
        awardedAny = true;
      }

      if (awardedAny) {
        // Filling the last place can end the game (and reconcile the pool).
        await this.finalizeDerashIfDone(room, cfg, 75, manager);
        await manager.save(room);
        return finish('won');
      }

      // Nothing to claim. A card that already won something isn't punished for a
      // redundant tap; a card that has never won and calls a false Bingo (tapped
      // BINGO before its winning pattern actually completed) is disqualified, the
      // way a false call is penalised in hall bingo.
      if ((ticket.wonTiers ?? []).length > 0) return finish('ignored');
      ticket.status = 'disqualified';
      ticket.disqualifiedReason = 'premature_claim';
      ticket.disqualifiedAt = new Date();
      // Stays PENDING (not settled) on purpose: the settlement tick keeps watching
      // this card. If it turns out to be the round's winning card, the prize goes to
      // the HOUSE (awardDerashPlaceToHouse) and the forfeit is recorded — never paid.
      ticket.settlementStatus = 'pending';
      await manager.save(ticket);
      // A pending-disqualified card that could still complete a winning pattern keeps
      // the game alive (finalizeDerashIfDone counts pending-DQ cards as in play).
      await this.finalizeDerashIfDone(room, cfg, 75, manager);
      await manager.save(room);
      return finish('disqualified');
    });
  }

  /**
   * Set the caller's Auto preference for a room. OFF flips every one of their
   * still-active cards to manual (settlement tick skips them; they must claim);
   * ON restores auto-award. Returns the applied value and how many cards changed.
   */
  async setAutoClaim(input: {
    userId: string;
    roomId: string;
    auto: boolean;
  }): Promise<{ autoClaim: boolean; updated: number }> {
    const userId = this.validateUuid(input.userId, 'userId');
    const roomId = this.validateUuid(input.roomId, 'roomId');
    const result = await this.bingoTicketRepository.update(
      { userId, roomId, status: 'active' },
      { autoClaim: input.auto },
    );
    return { autoClaim: input.auto, updated: result.affected ?? 0 };
  }

  /**
   * Resolve the winning pattern for a specific derash place. Falls back from the
   * per-place pattern → the legacy shared `prefilledWinPatternId` → "Any Line".
   */
  private async resolvePrefilledPlacePattern(
    cfg: BingoConfig,
    place: PrefilledPlace,
    manager: EntityManager,
  ): Promise<BingoPattern | null> {
    const perPlaceId: Record<PrefilledPlace, string | null | undefined> = {
      '1st': cfg.prefilledFirstPatternId,
      '2nd': cfg.prefilledSecondPatternId,
      '3rd': cfg.prefilledThirdPatternId,
      '4th': cfg.prefilledFourthPatternId,
      '5th': cfg.prefilledFifthPatternId,
    };
    const id = perPlaceId[place] ?? cfg.prefilledWinPatternId ?? null;
    if (id) {
      const chosen = await manager.findOne(BingoPattern, { where: { id } });
      if (chosen) return chosen;
    }
    return manager.findOne(BingoPattern, { where: { name: 'Any Line' } });
  }

  /**
   * Prize a derash/prefilled place pays out, in minor units.
   *
   * The whole house-adjusted pool is distributed across the ENABLED places by
   * weight (their configured percentages), normalised by the sum of enabled
   * weights. So with only 1st place enabled (the default) the winner takes the
   * FULL pool and `houseEdgePct` is the only deduction. Dividing by a hardcoded
   * 100 would cut a SECOND time whenever the enabled weights sum to < 100 (e.g.
   * the default 1st=80) — the "service fee taken twice" bug where a pot of 40
   * yielded a pool of 32 but paid the winner only 32*0.8 = 25.
   */
  computePrefilledPrizeMinor(
    totalPotMinor: number,
    place: PrefilledPlace,
    houseEdgePct: number,
    cfg: BingoConfig,
  ): number {
    const prizePoolMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));
    const placeWeight = this.prefilledPlaceWeight(place, cfg);
    const enabledWeightTotal = this.enabledPrefilledWeightTotal(cfg);
    return enabledWeightTotal > 0
      ? Math.floor((prizePoolMinor * placeWeight) / enabledWeightTotal)
      : 0;
  }

  /**
   * FINAL derash prize for a place after the game ends, distributing the whole
   * house-adjusted pool across the places that were ACTUALLY FILLED (normalise by
   * filled weights, not enabled). This is what a winner ends up with once
   * `reconcileDerashPool` tops up the progressive credit — so an enabled place that
   * nobody filled has its share redistributed to the real winners instead of being
   * silently kept by the house. With every enabled place filled it equals
   * `computePrefilledPrizeMinor`; with a single filled place it is the full pool.
   */
  computePrefilledFinalPrizeMinor(
    totalPotMinor: number,
    place: PrefilledPlace,
    houseEdgePct: number,
    filledPlaces: PrefilledPlace[],
    cfg: BingoConfig,
  ): number {
    const prizePoolMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));
    const placeWeight = this.prefilledPlaceWeight(place, cfg);
    const filledWeightTotal = filledPlaces.reduce((sum, p) => sum + this.prefilledPlaceWeight(p, cfg), 0);
    return filledWeightTotal > 0
      ? Math.floor((prizePoolMinor * placeWeight) / filledWeightTotal)
      : 0;
  }

  /** Configured payout weight for a prefilled place (raw %, used as a weight). */
  private prefilledPlaceWeight(place: PrefilledPlace, cfg: BingoConfig): number {
    switch (place) {
      case '1st': return cfg.prefilledFirstPlacePct ?? 80;
      case '2nd': return cfg.prefilledSecondPlacePct ?? 0;
      case '3rd': return cfg.prefilledThirdPlacePct ?? 0;
      case '4th': return cfg.prefilledFourthPlacePct ?? 0;
      case '5th': return cfg.prefilledFifthPlacePct ?? 0;
    }
  }

  /** Sum of payout weights across the places that are actually enabled. */
  private enabledPrefilledWeightTotal(cfg: BingoConfig): number {
    let total = cfg.prefilledFirstPlacePct ?? 80; // 1st place is always active
    if (cfg.prefilledSecondPlaceEnabled) total += cfg.prefilledSecondPlacePct ?? 0;
    if (cfg.prefilledThirdPlaceEnabled) total += cfg.prefilledThirdPlacePct ?? 0;
    if (cfg.prefilledFourthPlaceEnabled) total += cfg.prefilledFourthPlacePct ?? 0;
    if (cfg.prefilledFifthPlaceEnabled) total += cfg.prefilledFifthPlacePct ?? 0;
    return total;
  }

  private async evaluateAndSettleTiers(room: BingoRoom, manager: EntityManager): Promise<void> {
    const tickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: Not('cancelled') },
      order: { createdAt: 'ASC' },
    });

    for (const ticket of tickets) {
      const state = this.bingoRulesService.evaluateTicket(ticket.grid, room.drawnNumbers);
      ticket.markedNumbers = state.markedNumbers;
      ticket.completedLines = state.completedLines;
      await manager.save(ticket);
    }

    if (!room.settledTiers.includes('full_house')) {
      const houseEdgePct = room.houseEdgePct ?? 20;
      const totalPotMinor = tickets.length * room.ticketPriceMinor;
      const prizePotMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));

      let winner: BingoTicket | null = null;
      for (const ticket of tickets) {
        const state = this.bingoRulesService.evaluateTicket(ticket.grid, room.drawnNumbers);
        if (state.achievedTiers.includes('full_house')) {
          winner = ticket;
          break;
        }
      }

      if (winner) {
        const winnerUser = await manager.findOne(User, {
          where: { id: winner.userId },
          select: ['displayName', 'phoneNumber', 'productMetadata'],
        });
        const display = winnerUser
          ? await this.resolveDisplayedNameForUser(room, winnerUser, manager)
          : { displayName: 'Player', phoneLast4: '', phoneSuffix: undefined, isBot: false };

        winner.wonTiers = [...winner.wonTiers, 'full_house'];
        winner.payoutMinor += prizePotMinor;
        winner.status = 'won';
        winner.settlementStatus = 'settled';

        if (prizePotMinor > 0) {
          const winCredit = await this.walletService.creditInSession(
            {
              userId: winner.userId,
              amountMinor: prizePotMinor,
              entryType: 'win',
              sourceType: 'bingo_ticket',
              sourceId: winner.id,
              idempotencyKey: `bingo-settlement:full_house:${winner.id}`,
              metadata: {
                roomId: room.id,
                tier: 'full_house',
                displayName: display.displayName,
                drawnNumbers: room.drawnNumbers,
                completedLines: winner.completedLines,
                totalPotMinor,
                houseEdgePct,
              },
            },
            manager,
          );
          winner.walletCredits = [...winner.walletCredits, winCredit];
        }
        await manager.save(winner);

        room.settledTiers = [...room.settledTiers, 'full_house'];
        room.winnersByTier = { ...room.winnersByTier, full_house: [winner.id] };
        room.settlementSummary = {
          ...room.settlementSummary,
          full_house: {
            winnerCount: 1,
            winnerId: winner.id,
            winnerDisplayName: display.displayName,
            prizeMinor: prizePotMinor,
            totalPotMinor,
            houseEdgePct,
          },
        };
      }
    }
  }

  private async evaluateAndSettlePatterns(
    room: BingoRoom,
    patterns: BingoPattern[],
    manager: EntityManager,
  ): Promise<void> {
    if (patterns.length === 0) return;

    const tickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: Not('cancelled') },
      order: { createdAt: 'ASC' },
    });

    const patternPrizeMap = new Map(
      (room.patternPrizes ?? []).map((pp) => [pp.patternId, pp]),
    );

    const unsettledPatterns = patterns.filter((p) => !room.settledTiers.includes(p.id));
    if (unsettledPatterns.length === 0) return;

    const newWinnersByPattern = new Map<string, BingoTicket[]>();

    for (const ticket of tickets) {
      const state = this.bingoRulesService.evaluatePatternTicket(
        ticket.grid,
        room.drawnNumbers,
        unsettledPatterns,
      );

      ticket.markedNumbers = state.markedNumbers;

      const previouslyCompleted = new Set(ticket.completedPatterns ?? []);
      const newlyCompleted = state.completedPatternIds.filter(
        (pid) => !previouslyCompleted.has(pid),
      );

      for (const pid of newlyCompleted) {
        if (!newWinnersByPattern.has(pid)) newWinnersByPattern.set(pid, []);
        newWinnersByPattern.get(pid)!.push(ticket);
        ticket.completedPatterns = [...(ticket.completedPatterns ?? []), pid];
      }

      await manager.save(ticket);
    }

    for (const pattern of unsettledPatterns) {
      const winners = newWinnersByPattern.get(pattern.id) ?? [];
      if (winners.length === 0) continue;

      const patternConfig = patternPrizeMap.get(pattern.id);
      const prizeMinor = patternConfig?.prizeMinor ?? 0;
      const shares = this.bingoRulesService.splitPrizeMinor(prizeMinor, winners.length);
      const winnerUsers = await Promise.all(
        winners.map((t) =>
          manager.findOne(User, { where: { id: t.userId }, select: ['displayName', 'phoneNumber', 'productMetadata'] }),
        ),
      );
      const winnerDisplays = await Promise.all(
        winnerUsers.map((u) =>
          u ? this.resolveDisplayedNameForUser(room, u, manager) : Promise.resolve({ displayName: 'Player', phoneLast4: '', phoneSuffix: undefined, isBot: false }),
        ),
      );
      const winnerDisplayNames = winnerDisplays.map((d) => d.displayName);

      for (const [index, ticket] of winners.entries()) {
        const share = shares[index];
        ticket.payoutMinor += share;
        ticket.status = 'won';

        if (share > 0) {
          const winCredit = await this.walletService.creditInSession(
            {
              userId: ticket.userId,
              amountMinor: share,
              entryType: 'win',
              sourceType: 'bingo_ticket',
              sourceId: ticket.id,
              idempotencyKey: `bingo-settlement:${pattern.id}:${ticket.id}`,
              metadata: {
                roomId: room.id,
                patternId: pattern.id,
                patternName: pattern.name,
                displayName: winnerDisplays[index]?.displayName ?? 'Player',
                drawnNumbers: room.drawnNumbers,
              },
            },
            manager,
          );
          ticket.walletCredits.push(winCredit);
        }
        await manager.save(ticket);
      }

      room.settledTiers = [...room.settledTiers, pattern.id];
      room.winnersByTier = { ...room.winnersByTier, [pattern.id]: winners.map((t) => t.id) };
      room.settlementSummary = {
        ...room.settlementSummary,
        [pattern.id]: {
          patternName: pattern.name,
          winnerCount: winners.length,
          winnerDisplayNames,
          prizeMinor,
          shares,
        },
      };
    }
  }

  async getRoomWinners(roomId: string): Promise<{ userId: string; payoutMinor: number }[]> {
    return this.bingoTicketRepository.find({
      where: { roomId, status: 'won', settlementStatus: 'settled' },
      select: ['userId', 'payoutMinor'],
    });
  }

  /**
   * Persist an in-app "win" notification per (human) winner of a completed room,
   * aggregating multiple winning cartelas into one total. Bot accounts are
   * skipped. Called once, at completion — so the win reaches a player even if
   * they had left the game screen.
   */
  async notifyRoomWinners(roomId: string): Promise<void> {
    const winners = await this.getRoomWinners(roomId);
    const totalByUser = new Map<string, number>();
    for (const w of winners) {
      if (w.payoutMinor > 0) totalByUser.set(w.userId, (totalByUser.get(w.userId) ?? 0) + w.payoutMinor);
    }
    if (totalByUser.size === 0) return;

    const users = await this.dataSource.getRepository(User).find({
      where: { id: In([...totalByUser.keys()]) },
      select: ['id', 'productMetadata'],
    });
    const isBot = new Map(users.map((u) => [u.id, u.productMetadata?.botPolicy != null]));

    for (const [userId, payoutMinor] of totalByUser) {
      if (isBot.get(userId)) continue; // don't notify bot accounts
      await this.notificationsService.safeCreate({
        userId,
        type: 'win',
        title: 'Bingo win! 🎉',
        body: `You won ${payoutMinor.toLocaleString()} ETB in Bingo.`,
        data: { game: 'bingo', roomId, amountMinor: payoutMinor },
      });
    }
  }

  async getSpectatorView(roomId: string): Promise<Array<{
    grid: BingoGrid;
    markedNumbers: number[];
    status: string;
  }>> {
    const validRoomId = this.validateUuid(roomId, 'roomId');
    const tickets = await this.bingoTicketRepository.find({
      where: { roomId: validRoomId, status: Not('cancelled') },
      select: ['grid', 'markedNumbers', 'status'],
      order: { createdAt: 'ASC' },
    });
    return tickets.map((t) => ({
      grid: t.grid,
      markedNumbers: t.markedNumbers,
      status: t.status,
    }));
  }

  private async getTakenSpots(roomId: string): Promise<number[]> {
    // Source of truth is the card pool: a cartela is taken once its card has
    // been assigned to a ticket.
    const rows: Array<{ cartelaNumber: number | string | null }> = await this.bingoCardRepository.query(
      `SELECT cartelaNumber FROM bingo_cards WHERE roomId = ? AND assignedTicketId IS NOT NULL`,
      [roomId],
    );
    return rows
      .map((r) => Number(r.cartelaNumber))
      .filter((n) => Number.isFinite(n));
  }

  private async markRemainingTicketsLost(room: BingoRoom, manager: EntityManager): Promise<void> {
    await manager.update(
      BingoTicket,
      { roomId: room.id, status: 'active' },
      { status: 'lost', settlementStatus: 'settled' },
    );
  }

  /**
   * Live count of tickets that count toward the pot — every row that is NOT
   * cancelled (active/won/lost are all paid stakes; cancelled were refunded).
   * Both the advertised prize (toRoomResponse) and settlement use THIS single
   * source, so the paid pot can never drift from the advertised pot the way the
   * persisted `room.soldTickets` counter could if an increment/decrement was
   * ever missed.
   */
  private async countSoldTickets(roomId: string, manager?: EntityManager): Promise<number> {
    const where: FindOptionsWhere<BingoTicket> = { roomId, status: Not('cancelled') };
    return manager
      ? manager.countBy(BingoTicket, where)
      : this.bingoTicketRepository.countBy(where);
  }

  /** Distinct REAL (non-bot) players holding a non-cancelled ticket in the room. */
  async countRealPlayersInRoom(roomId: string, manager?: EntityManager): Promise<number> {
    const runner = manager ?? this.bingoTicketRepository.manager;
    const rows: Array<{ c: number | string }> = await runner.query(
      `SELECT COUNT(DISTINCT t.userId) AS c
         FROM bingo_tickets t
         JOIN users u ON u.id = t.userId
        WHERE t.roomId = ? AND t.status <> 'cancelled'
          AND JSON_EXTRACT(u.productMetadata, '$.botPolicy') IS NULL`,
      [roomId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  /** Count of non-cancelled cartelas held by bots in the room (one ticket row = one cartela). */
  async countBotCartelasInRoom(roomId: string, manager?: EntityManager): Promise<number> {
    const runner = manager ?? this.bingoTicketRepository.manager;
    const rows: Array<{ c: number | string }> = await runner.query(
      `SELECT COUNT(*) AS c
         FROM bingo_tickets t
         JOIN users u ON u.id = t.userId
        WHERE t.roomId = ? AND t.status <> 'cancelled'
          AND JSON_EXTRACT(u.productMetadata, '$.botPolicy') IS NOT NULL`,
      [roomId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  private async cancelRoomWithRefundsInSession(
    room: BingoRoom,
    manager: EntityManager,
    reason: string,
  ): Promise<void> {
    if (room.status === 'cancelled' || room.status === 'completed') return;

    const tickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, settlementStatus: 'pending' },
      order: { createdAt: 'ASC' },
    });

    let totalRefundMinor = 0;
    for (const ticket of tickets) {
      totalRefundMinor += ticket.stakeMinor;
      ticket.status = 'cancelled';
      ticket.settlementStatus = 'settled';

      const refundCredit = await this.walletService.creditInSession(
        {
          userId: ticket.userId,
          amountMinor: ticket.stakeMinor,
          entryType: 'refund',
          sourceType: 'bingo_ticket',
          sourceId: ticket.id,
          idempotencyKey: `bingo-refund:${ticket.id}`,
          metadata: { roomId: room.id, reason },
        },
        manager,
      );

      ticket.walletCredits = [...(ticket.walletCredits ?? []), refundCredit];
      await manager.save(ticket);
    }

    room.status = 'cancelled';
    room.activeGuard = null;
    room.soldTickets = 0;
    room.settlementSummary = {
      ticketCount: tickets.length,
      totalRefundMinor,
      reason,
    };
    await manager.save(room);
  }

  /** Count of non-cancelled cartelas a single user (bot or real) holds in the room. */
  async countUserCartelasInRoom(userId: string, roomId: string, manager?: EntityManager): Promise<number> {
    const where: FindOptionsWhere<BingoTicket> = { userId, roomId, status: Not('cancelled') };
    return manager
      ? manager.countBy(BingoTicket, where)
      : this.bingoTicketRepository.countBy(where);
  }

  /**
   * Open rooms with an active or just-expired buy-window countdown (first ticket
   * sold, scheduledStartAt stamped). Used by the scheduler to progressively top up
   * bot cartela purchases throughout the countdown instead of one lump buy at the
   * end — no time-bound filter here since the caller derives elapsed fraction itself.
   */
  async findOpenRoomsWithCountdown(): Promise<BingoRoom[]> {
    return this.bingoRoomRepository.find({
      where: { status: 'open', soldTickets: MoreThan(0), scheduledStartAt: Not(IsNull()) },
    });
  }

  /** Set of active (house-controlled) bot userIds. */
  private async getActiveBotUserIds(manager: EntityManager): Promise<Set<string>> {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM users
        WHERE JSON_EXTRACT(productMetadata, '$.botPolicy') IS NOT NULL
          AND JSON_EXTRACT(productMetadata, '$.botPolicy.active') = true`,
    );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Pick the bot cartela to hand a redirected win to. Prefers a bot whose card
   * actually completes the pattern (so the revealed winner card looks legitimate);
   * otherwise the in-play bot card closest to completing (most marked cells).
   * Overrides the bot's grid to precisely match the real winner's so the win is mathematically valid.
   */
  private pickBotRedirectWinner(
    inPlay: BingoTicket[],
    botIds: Set<string>,
    pattern: BingoPattern,
    drawnNumbers: number[],
  ): BingoTicket | null {
    const botTickets = inPlay.filter((t) => botIds.has(t.userId));
    if (botTickets.length === 0) return null;

    // First preference: a bot ticket that ALREADY naturally completes the pattern
    // on its own grid — the most legitimate scenario.
    const naturalWinner = botTickets.find((t) =>
      this.bingoRulesService
        .evaluatePatternTicket(t.grid, drawnNumbers, [pattern])
        .completedPatternIds.includes(pattern.id),
    );
    if (naturalWinner) return naturalWinner;

    // Second preference: the bot ticket with the most matched cells on its own grid
    // (closest to completing). We return it AS-IS — its own real cartela layout —
    // never touching the real player's grid. The win is steered to this bot's real
    // cartela, which the admin can verify is legitimately purchased.
    const drawnSet = new Set(drawnNumbers);
    return botTickets
      .map((t) => ({
        t,
        marks: t.grid.flat().filter((v): v is number => v !== null && drawnSet.has(v)).length,
      }))
      .sort((a, b) => b.marks - a.marks)[0]?.t ?? null;
  }

  /**
   * Deterministically maps a room UUID to a non-negative integer so alias pool
   * indexing is consistent within a room (same game → same alias slot base).
   * Uses a simple djb2-style hash over the UUID characters.
   */
  private hashRoomIdToInt(roomId: string): number {
    let hash = 0;
    for (let i = 0; i < roomId.length; i++) {
      hash = (hash * 31 + roomId.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
    }
    return hash;
  }

  private async findRoom(roomId: string): Promise<BingoRoom> {
    const room = await this.bingoRoomRepository.findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('Bingo room not found');
    return room;
  }

  private toRoomResponse(room: BingoRoom, soldTickets: number, takenSpots?: number[]): BingoRoomResponse {
    const houseEdgePct = room.houseEdgePct ?? 20;
    const totalPotMinor = soldTickets * room.ticketPriceMinor;
    const prizeMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      ticketPriceMinor: room.ticketPriceMinor,
      maxTickets: room.maxTickets,
      soldTickets,
      prizes: {
        oneLineMinor: room.prizes.oneLineMinor,
        twoLinesMinor: room.prizes.twoLinesMinor,
        fullHouseMinor: room.prizes.fullHouseMinor,
      },
      winMode: room.winMode ?? 'prefilled',
      numberRange: room.numberRange ?? 90,
      gridSize: room.gridSize ?? 75,
      patternPrizes: room.patternPrizes ?? [],
      scheduledStartAt: room.scheduledStartAt,
      createdAt: room.createdAt,
      drawnNumbers: room.drawnNumbers,
      settledTiers: room.settledTiers,
      winnersByTier: room.winnersByTier,
      settlementSummary: room.settlementSummary || {},
      houseEdgePct,
      prizeMinor,
      takenSpots: room.winMode === 'prefilled' ? (takenSpots ?? []) : undefined,
    };
  }

  private toTicketResponse(ticket: BingoTicket): BingoTicketResponse {
    return {
      id: ticket.id,
      userId: ticket.userId,
      roomId: ticket.roomId,
      cartelaNumber: ticket.cartelaNumber ?? null,
      grid: ticket.grid,
      markedNumbers: ticket.markedNumbers,
      completedLines: ticket.completedLines,
      wonTiers: ticket.wonTiers,
      completedPatterns: ticket.completedPatterns ?? [],
      stakeMinor: ticket.stakeMinor,
      payoutMinor: ticket.payoutMinor,
      status: ticket.status,
      settlementStatus: ticket.settlementStatus,
      autoClaim: ticket.autoClaim ?? true,
      disqualifiedReason: ticket.disqualifiedReason ?? null,
      disqualifiedWonRound: ticket.disqualifiedWonRound ?? false,
      forfeitedWinMinor: ticket.forfeitedWinMinor ?? 0,
    };
  }

  private validateUuid(value: string, name: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) throw new BadRequestException(`${name} must be a valid UUID`);
    return value;
  }
}

