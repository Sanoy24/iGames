import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource, In, IsNull, LessThan, LessThanOrEqual, Not, FindOptionsWhere } from 'typeorm';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { BingoRulesService, BUILT_IN_PATTERNS } from './bingo-rules.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { UpdateBingoConfigDto } from './dto/update-bingo-config.dto';
import { CreateBingoPatternDto, UpdateBingoPatternDto } from './dto/create-bingo-pattern.dto';
import { BingoConfig } from './entities/bingo-config.entity';
import { BingoRoom, BingoPrizeTier, BingoWinMode } from './entities/bingo-room.entity';
import { BingoGrid, BingoTicket } from './entities/bingo-ticket.entity';
import { BingoCard } from './entities/bingo-card.entity';
import { BingoPattern } from './entities/bingo-pattern.entity';
import { User } from '../users/entities/user.entity';

/** Prefilled/derash finishing places, in award order. */
export type PrefilledPlace = '1st' | '2nd' | '3rd' | '4th' | '5th';
export const PREFILLED_PLACES: PrefilledPlace[] = ['1st', '2nd', '3rd', '4th', '5th'];
import { NotificationsService } from '../notifications/notifications.service';

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
  scheduledStartAt: Date;
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
};

const MIN_BINGO_SALES_WINDOW_MS = 15_000;

@Injectable()
export class BingoService implements OnModuleInit {
  private readonly logger = new Logger(BingoService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BingoRoom)
    private readonly bingoRoomRepository: Repository<BingoRoom>,
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
    private readonly notificationsService: NotificationsService
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

    const winMode = (cfg.defaultWinMode as BingoWinMode) ?? 'prefilled';
    const gridSize = cfg.defaultGridSize ?? 75;

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

    const salesWindowMs = Math.max((cfg.salesWindowSeconds ?? 40) * 1000, MIN_BINGO_SALES_WINDOW_MS);
    const delayMs = Math.max(cfg.autoRepeatIntervalMinutes * 60_000, salesWindowMs);
    const scheduledStartAt = new Date(Date.now() + delayMs);

    const timestamp = scheduledStartAt.toLocaleTimeString('en-ET', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const name = `Bingo ${timestamp}`;

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
      // Ball pool: derash fixed 75-ball, line 90, pattern configurable.
      numberRange: this.ballPoolFor(winMode, cfg),
      gridSize,
      patternPrizes: [],
      houseEdgePct: cfg.houseEdgePct ?? 20,
      scheduledStartAt,
      drawnNumbers: [],
      rngAuditLogIds: [],
      settledTiers: [],
      winnersByTier: {},
      settlementSummary: {},
      activeGuard: 1, // claims the single "active game" slot (unique index)
    });

    try {
      // Room + its card pool are created atomically, so a room never becomes
      // visible without its full pre-generated pool of cards.
      await this.dataSource.transaction(async (manager) => {
        await manager.save(room);
        await this.generateCardPoolForRoom(room, manager);
      });
    } catch (err) {
      // Another creator (concurrent request or separate instance) already holds
      // the active-game slot. Treat as "a room already exists" and back off.
      if (this.isDuplicateKeyError(err)) {
        this.logger.warn('Active Bingo room already exists (activeGuard conflict) — skipping creation');
        return null;
      }
      throw err;
    }
    this.logger.log(`Auto-created Bingo room "${room.name}" (${winMode}) starting at ${scheduledStartAt.toISOString()}`);
    return this.toRoomResponse(room, 0, []);
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

    const room = await this.bingoRoomRepository.findOne({
      where: { status: 'open', scheduledStartAt: LessThanOrEqual(new Date()) },
      order: { scheduledStartAt: 'ASC' },
    });
    if (!room) return [];

    const soldTickets = await this.countSoldTickets(room.id);
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
    const rooms = await this.bingoRoomRepository.find({
      order: { scheduledStartAt: 'DESC' },
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
      const tickets = await this.bingoTicketRepository.find({
        where: { roomId: room.id, userId: input.userId },
        order: { createdAt: 'DESC' },
      });
      response.tickets = tickets.map((ticket) => this.toTicketResponse(ticket));
    }

    return response;
  }

  // ── Ticket purchase ──────────────────────────────────────────────────────────

  async purchaseTickets(input: {
    userId: string;
    roomId: string;
    count?: number;
    cartelaNumbers?: number[];
    idempotencyKey: string;
    selectedNumbers?: number[];
  }): Promise<BingoTicketResponse[]> {
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

        room.soldTickets += cartelaNumbers.length;
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

      room.soldTickets += count;
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
            // No more draws possible — mark all remaining active tickets as lost.
          } else if (room.winMode === 'pattern') {
            const patternIds = (room.patternPrizes ?? []).map((pp) => pp.patternId);
            const patterns =
              patternIds.length > 0
                ? await manager.find(BingoPattern, { where: { id: In(patternIds) } })
                : [];
            await this.evaluateAndSettlePatterns(room, patterns, manager);
          } else {
            await this.evaluateAndSettleTiers(room, manager);
          }
          await this.markRemainingTicketsLost(room, manager);
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
        if (room.drawnNumbers.length >= minDrawsBeforeWin) {
          await this.evaluateAndSettleDerash(room, cfg, manager);
        }
        await this.finalizeDerashIfDone(room, cfg, maxNumber, manager);
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

      const tickets = await manager.find(BingoTicket, {
        where: { roomId: room.id, settlementStatus: 'pending' },
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
            metadata: { roomId: room.id, reason: 'bingo_room_cancelled' },
          },
          manager,
        );

        ticket.walletCredits.push(refundCredit);
        await manager.save(ticket);
      }

      room.status = 'cancelled';
      room.activeGuard = null; // free the active-game slot
      room.settlementSummary = {
        ticketCount: tickets.length,
        totalRefundMinor,
        reason: 'bingo_room_cancelled',
      };

      await manager.save(room);
      return this.toRoomResponse(room, tickets.length);
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
    const activeTickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: 'active' },
      order: { createdAt: 'ASC' },
    });
    if (activeTickets.length === 0) return;

    // Re-mark every active card against the current draw (marking is independent
    // of any win pattern, so cards light up as numbers are called).
    const drawn = new Set(room.drawnNumbers);
    for (const ticket of activeTickets) {
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
    const prizePoolMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));

    // Cache resolved patterns per place across the loop to avoid repeat lookups.
    const patternCache = new Map<PrefilledPlace, BingoPattern | null>();
    const awardedThisPass = new Set<string>();

    // Award each still-open place, in order, to the earliest active card that
    // completes that place's pattern. `nextOpenPrefilledPlace` re-reads
    // settledTiers, so it advances as places are filled below.
    for (
      let place = this.nextOpenPrefilledPlace(room, cfg);
      place !== null;
      place = this.nextOpenPrefilledPlace(room, cfg)
    ) {
      let pattern = patternCache.get(place);
      if (pattern === undefined) {
        pattern = await this.resolvePrefilledPlacePattern(cfg, place, manager);
        patternCache.set(place, pattern);
      }
      if (!pattern) break;

      const winner = activeTickets.find(
        (t) =>
          !awardedThisPass.has(t.id) &&
          // Manual-mode cards (owner turned Auto OFF) are never auto-awarded —
          // they can only win via an explicit "Bingo" claim (claimBingo).
          t.autoClaim !== false &&
          this.bingoRulesService
            .evaluatePatternTicket(t.grid, room.drawnNumbers, [pattern as BingoPattern])
            .completedPatternIds.includes((pattern as BingoPattern).id),
      );
      // No card completes this place's pattern yet — stop; a later draw may.
      if (!winner) break;

      await this.awardDerashPlace({ room, winner, place, pattern, totalPotMinor, houseEdgePct, cfg, manager });
      awardedThisPass.add(winner.id);
    }
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
  }): Promise<void> {
    const { room, winner, place, pattern, totalPotMinor, houseEdgePct, cfg, manager } = input;
    const prizePoolMinor = Math.floor(totalPotMinor * (1 - houseEdgePct / 100));
    const prizeMinor = this.computePrefilledPrizeMinor(totalPotMinor, place, houseEdgePct, cfg);

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
          },
        },
        manager,
      );
      winner.walletCredits = [...(winner.walletCredits ?? []), winCredit];
    }

    await manager.save(winner);

    const winnerUser = await manager.findOne(User, {
      where: { id: winner.userId },
      select: ['displayName', 'phoneNumber'],
    });
    const phoneLast4 = (winnerUser?.phoneNumber ?? '').replace(/\D/g, '').slice(-4);

    room.settledTiers = [...room.settledTiers, place];
    room.winnersByTier = { ...room.winnersByTier, [place]: [winner.id] };
    room.settlementSummary = {
      ...room.settlementSummary,
      [place]: {
        winnerCount: 1,
        winnerId: winner.id,
        winnerDisplayName: winnerUser?.displayName ?? 'Player',
        winnerPhoneLast4: phoneLast4,
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
   * Ends a derash room once there is nothing left to play for: every enabled
   * place is filled, no cards remain active (all won/lost/disqualified), or the
   * ball pool is exhausted. Shared by the draw tick and the manual claim so a
   * claim that fills the last place closes the game immediately. Returns whether
   * the room was completed.
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
    // End the game as soon as there is nothing left to draw for: all enabled
    // places filled, the pool is exhausted, OR no still-eligible cartelas remain.
    const remainingActive = await manager.countBy(BingoTicket, {
      roomId: room.id,
      status: 'active',
    });
    if (
      room.settledTiers.length >= totalPlaces ||
      remainingActive === 0 ||
      room.drawnNumbers.length >= maxNumber
    ) {
      room.status = 'completed';
      room.activeGuard = null;
      await this.markRemainingTicketsLost(room, manager);
      return true;
    }
    return false;
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

      // Already settled (won/lost/disqualified) — nothing to claim.
      if (ticket.status !== 'active') return finish('ignored');

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

      const openPlace = this.nextOpenPrefilledPlace(room, cfg);

      if (openPlace) {
        const pattern = await this.resolvePrefilledPlacePattern(cfg, openPlace, manager);
        if (completesPattern(pattern)) {
          const soldTickets = await this.countSoldTickets(roomId, manager);
          const totalPotMinor = soldTickets * room.ticketPriceMinor;
          const houseEdgePct = room.houseEdgePct ?? 20;
          await this.awardDerashPlace({
            room,
            winner: ticket,
            place: openPlace,
            pattern: pattern as BingoPattern,
            totalPotMinor,
            houseEdgePct,
            cfg,
            manager,
          });
          const maxNumber = 75;
          await this.finalizeDerashIfDone(room, cfg, maxNumber, manager);
          await manager.save(room);
          return finish('won');
        }
      }

      // Not eligible for an open place. If the card DID complete a winning
      // pattern that has already been awarded, the player was beaten to it →
      // disqualified. Otherwise the tap was premature → ignored (no penalty).
      const beaten = await this.completesAnySettledDerashPlace(room, cfg, ticket, manager);
      if (beaten) {
        ticket.status = 'disqualified';
        ticket.settlementStatus = 'settled';
        await manager.save(ticket);
        // A disqualification can remove the last active card, ending the game.
        await this.finalizeDerashIfDone(room, cfg, 75, manager);
        await manager.save(room);
        return finish('disqualified');
      }

      await manager.save(ticket);
      return finish('ignored');
    });
  }

  /**
   * True if the card completes the pattern of any place that has ALREADY been
   * settled in this room — i.e. it "had bingo" but lost the race for that place.
   */
  private async completesAnySettledDerashPlace(
    room: BingoRoom,
    cfg: BingoConfig,
    ticket: BingoTicket,
    manager: EntityManager,
  ): Promise<boolean> {
    const settledPlaces = room.settledTiers.filter((t): t is PrefilledPlace =>
      ['1st', '2nd', '3rd', '4th', '5th'].includes(t),
    );
    for (const place of settledPlaces) {
      const pattern = await this.resolvePrefilledPlacePattern(cfg, place, manager);
      if (
        pattern &&
        this.bingoRulesService
          .evaluatePatternTicket(ticket.grid, room.drawnNumbers, [pattern])
          .completedPatternIds.includes(pattern.id)
      ) {
        return true;
      }
    }
    return false;
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

  private nextOpenPrefilledPlace(room: BingoRoom, cfg: BingoConfig): PrefilledPlace | null {
    if (!room.settledTiers.includes('1st')) return '1st';
    if (cfg.prefilledSecondPlaceEnabled && !room.settledTiers.includes('2nd')) return '2nd';
    if (cfg.prefilledThirdPlaceEnabled && !room.settledTiers.includes('3rd')) return '3rd';
    if (cfg.prefilledFourthPlaceEnabled && !room.settledTiers.includes('4th')) return '4th';
    if (cfg.prefilledFifthPlaceEnabled && !room.settledTiers.includes('5th')) return '5th';
    return null;
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

        const winnerUser = await manager.findOne(User, { where: { id: winner.userId }, select: ['displayName'] });
        room.settledTiers = [...room.settledTiers, 'full_house'];
        room.winnersByTier = { ...room.winnersByTier, full_house: [winner.id] };
        room.settlementSummary = {
          ...room.settlementSummary,
          full_house: {
            winnerCount: 1,
            winnerId: winner.id,
            winnerDisplayName: winnerUser?.displayName ?? 'Player',
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
                drawnNumbers: room.drawnNumbers,
              },
            },
            manager,
          );
          ticket.walletCredits.push(winCredit);
        }
        await manager.save(ticket);
      }

      const winnerUsers = await Promise.all(
        winners.map((t) => manager.findOne(User, { where: { id: t.userId }, select: ['displayName'] })),
      );
      const winnerDisplayNames = winnerUsers.map((u) => u?.displayName ?? 'Player');

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
    };
  }

  private validateUuid(value: string, name: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) throw new BadRequestException(`${name} must be a valid UUID`);
    return value;
  }
}
