import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource, In, LessThan, LessThanOrEqual, Not } from 'typeorm';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { BingoRulesService, BUILT_IN_PATTERNS } from './bingo-rules.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { UpdateBingoConfigDto } from './dto/update-bingo-config.dto';
import { CreateBingoPatternDto, UpdateBingoPatternDto } from './dto/create-bingo-pattern.dto';
import { BingoConfig } from './entities/bingo-config.entity';
import { BingoRoom, BingoPrizeTier } from './entities/bingo-room.entity';
import { BingoTicket } from './entities/bingo-ticket.entity';
import { BingoPattern } from './entities/bingo-pattern.entity';

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
  patternPrizes: Array<{ patternId: string; name: string; prizeMinor: number }>;
  scheduledStartAt: Date;
  drawnNumbers: number[];
  settledTiers: string[];
  winnersByTier: Record<string, string[]>;
  settlementSummary: Record<string, unknown>;
};

export type BingoTicketResponse = {
  id: string;
  userId: string;
  roomId: string;
  grid: Array<Array<number | null>>;
  markedNumbers: number[];
  completedLines: number[];
  wonTiers: string[];
  completedPatterns: string[];
  stakeMinor: number;
  payoutMinor: number;
  status: string;
  settlementStatus: string;
};

const MIN_BINGO_SALES_WINDOW_MS = 60_000;

@Injectable()
export class BingoService implements OnModuleInit {
  private readonly logger = new Logger(BingoService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BingoRoom)
    private readonly bingoRoomRepository: Repository<BingoRoom>,
    @InjectRepository(BingoTicket)
    private readonly bingoTicketRepository: Repository<BingoTicket>,
    @InjectRepository(BingoConfig)
    private readonly bingoConfigRepository: Repository<BingoConfig>,
    @InjectRepository(BingoPattern)
    private readonly bingoPatternRepository: Repository<BingoPattern>,
    private readonly bingoRulesService: BingoRulesService,
    private readonly rngService: RngService,
    private readonly walletService: WalletService
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
        defaultOneLineMinor: 20000,
        defaultTwoLinesMinor: 50000,
        defaultFullHouseMinor: 100000,
        drawIntervalSeconds: 5,
        defaultWinMode: 'line',
        defaultNumberRange: 75,
      });
      await this.bingoConfigRepository.save(cfg);
    }
    return cfg;
  }

  async updateBingoConfig(dto: UpdateBingoConfigDto): Promise<BingoConfig> {
    const cfg = await this.getBingoConfig();
    Object.assign(cfg, dto);
    return this.bingoConfigRepository.save(cfg);
  }

  async autoCreateNextRoom(): Promise<BingoRoomResponse | null> {
    const cfg = await this.getBingoConfig();
    if (!cfg.enabled) return null;

    const existing = await this.bingoRoomRepository.countBy({ status: 'open' });
    if (existing > 0) return null;

    const delayMs = Math.max(cfg.autoRepeatIntervalMinutes * 60_000, MIN_BINGO_SALES_WINDOW_MS);
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
      maxTickets: cfg.defaultMaxTickets,
      prizes: {
        oneLineMinor: cfg.defaultOneLineMinor,
        twoLinesMinor: cfg.defaultTwoLinesMinor,
        fullHouseMinor: cfg.defaultFullHouseMinor,
      },
      winMode: (cfg.defaultWinMode as 'line' | 'pattern') ?? 'line',
      numberRange: cfg.defaultNumberRange ?? 90,
      patternPrizes: [],
      scheduledStartAt,
      drawnNumbers: [],
      rngAuditLogIds: [],
      settledTiers: [],
      winnersByTier: {},
      settlementSummary: {},
    });

    await this.bingoRoomRepository.save(room);
    this.logger.log(`Auto-created Bingo room "${room.name}" starting at ${scheduledStartAt.toISOString()}`);
    return this.toRoomResponse(room, 0);
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

  async findRoomsToStart(): Promise<BingoRoomResponse[]> {
    const rooms = await this.bingoRoomRepository.find({
      where: { status: 'open', scheduledStartAt: LessThanOrEqual(new Date()) },
    });
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

  async createRoom(dto: CreateBingoRoomDto): Promise<BingoRoomResponse> {
    const room = this.bingoRoomRepository.create({
      name: dto.name,
      status: 'open',
      ticketPriceMinor: dto.ticketPriceMinor,
      maxTickets: dto.maxTickets,
      prizes: dto.prizes,
      winMode: (dto.winMode as 'line' | 'pattern') ?? 'line',
      numberRange: dto.numberRange ?? 90,
      patternPrizes: dto.patternPrizes ?? [],
      scheduledStartAt: dto.scheduledStartAt ? new Date(dto.scheduledStartAt) : new Date(),
      drawnNumbers: [],
      rngAuditLogIds: [],
      settledTiers: [],
      winnersByTier: {},
      settlementSummary: {},
    });

    await this.bingoRoomRepository.save(room);
    return this.toRoomResponse(room, 0);
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
    const soldTickets = await this.bingoTicketRepository.countBy({ roomId: room.id });
    const response: BingoRoomResponse & { tickets?: BingoTicketResponse[] } = this.toRoomResponse(room, soldTickets);

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
    count: number;
    idempotencyKey: string;
  }): Promise<BingoTicketResponse[]> {
    if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 24) {
      throw new BadRequestException('Bingo ticket count must be between 1 and 24');
    }

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
      if (room.soldTickets + input.count > room.maxTickets) {
        throw new ConflictException('Bingo room is full for ticket sales');
      }

      room.soldTickets += input.count;
      await manager.save(room);

      const createdTickets: BingoTicket[] = [];
      for (let index = 0; index < input.count; index += 1) {
        const isPatternMode = room.winMode === 'pattern';
        const grid = isPatternMode
          ? this.bingoRulesService.generatePatternCard(room.numberRange ?? 75)
          : this.bingoRulesService.generateTicket();

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

  // ── Draw ─────────────────────────────────────────────────────────────────────

  async drawNextNumber(roomId: string): Promise<BingoRoomResponse> {
    const validRoomId = this.validateUuid(roomId, 'roomId');

    return await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(BingoRoom, {
        where: { id: validRoomId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!room) throw new NotFoundException('Bingo room not found');

      if (room.status === 'completed' || room.status === 'cancelled') {
        const soldTickets = await manager.countBy(BingoTicket, { roomId: validRoomId });
        return this.toRoomResponse(room, soldTickets);
      }

      const maxNumber = room.winMode === 'pattern' ? (room.numberRange ?? 75) : 90;

      if (room.drawnNumbers.length >= maxNumber) {
        throw new ConflictException('All Bingo numbers have already been drawn');
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
      room.drawnNumbers.push(drawnNumber);
      if (rngResult.auditLogId) room.rngAuditLogIds.push(rngResult.auditLogId);

      if (room.winMode === 'pattern') {
        const patternIds = (room.patternPrizes ?? []).map((pp) => pp.patternId);
        const patterns =
          patternIds.length > 0
            ? await manager.find(BingoPattern, { where: { id: In(patternIds) } })
            : [];
        await this.evaluateAndSettlePatterns(room, patterns, manager);

        const allSettled =
          patternIds.length > 0 && patternIds.every((pid) => room.settledTiers.includes(pid));
        if (allSettled || room.drawnNumbers.length >= maxNumber) {
          room.status = 'completed';
          await this.markRemainingTicketsLost(room, manager);
        }
      } else {
        await this.evaluateAndSettleTiers(room, manager);
        if (room.settledTiers.includes('full_house')) {
          room.status = 'completed';
          await this.markRemainingTicketsLost(room, manager);
        }
      }

      await manager.save(room);
      const soldTickets = await manager.countBy(BingoTicket, { roomId: validRoomId });
      return this.toRoomResponse(room, soldTickets);
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
        const soldTickets = await manager.countBy(BingoTicket, { roomId: validRoomId });
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

  private async evaluateAndSettleTiers(room: BingoRoom, manager: EntityManager): Promise<void> {
    const tickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: Not('cancelled') },
      order: { createdAt: 'ASC' },
    });

    const newlyQualifiedByTier = new Map<BingoPrizeTier, BingoTicket[]>([
      ['one_line', []],
      ['two_lines', []],
      ['full_house', []],
    ]);

    for (const ticket of tickets) {
      const state = this.bingoRulesService.evaluateTicket(ticket.grid, room.drawnNumbers);
      ticket.markedNumbers = state.markedNumbers;
      ticket.completedLines = state.completedLines;

      for (const tier of state.achievedTiers) {
        if (!room.settledTiers.includes(tier) && !ticket.wonTiers.includes(tier)) {
          newlyQualifiedByTier.get(tier)?.push(ticket);
        }
      }
      await manager.save(ticket);
    }

    for (const tier of ['one_line', 'two_lines', 'full_house'] as BingoPrizeTier[]) {
      const winners = newlyQualifiedByTier.get(tier) ?? [];
      if (winners.length === 0 || room.settledTiers.includes(tier)) continue;

      const shares = this.bingoRulesService.splitPrizeMinor(this.getPrizeMinor(room, tier), winners.length);
      for (const [index, ticket] of winners.entries()) {
        const share = shares[index];
        ticket.wonTiers.push(tier);
        ticket.payoutMinor += share;
        ticket.status = 'won';
        if (tier === 'full_house') ticket.settlementStatus = 'settled';

        if (share > 0) {
          const winCredit = await this.walletService.creditInSession(
            {
              userId: ticket.userId,
              amountMinor: share,
              entryType: 'win',
              sourceType: 'bingo_ticket',
              sourceId: ticket.id,
              idempotencyKey: `bingo-settlement:${tier}:${ticket.id}`,
              metadata: {
                roomId: room.id,
                tier,
                drawnNumbers: room.drawnNumbers,
                completedLines: ticket.completedLines,
              },
            },
            manager,
          );
          ticket.walletCredits.push(winCredit);
        }
        await manager.save(ticket);
      }

      room.settledTiers.push(tier);
      room.winnersByTier = { ...room.winnersByTier, [tier]: winners.map((t) => t.id) };
      room.settlementSummary = {
        ...room.settlementSummary,
        [tier]: { winnerCount: winners.length, prizeMinor: this.getPrizeMinor(room, tier), shares },
      };
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

    // Only evaluate patterns not yet settled
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

    // Settle each newly-won pattern
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

      room.settledTiers = [...room.settledTiers, pattern.id];
      room.winnersByTier = { ...room.winnersByTier, [pattern.id]: winners.map((t) => t.id) };
      room.settlementSummary = {
        ...room.settlementSummary,
        [pattern.id]: {
          patternName: pattern.name,
          winnerCount: winners.length,
          prizeMinor,
          shares,
        },
      };
    }
  }

  private async markRemainingTicketsLost(room: BingoRoom, manager: EntityManager): Promise<void> {
    await manager.update(
      BingoTicket,
      { roomId: room.id, status: 'active' },
      { status: 'lost', settlementStatus: 'settled' },
    );
  }

  private getPrizeMinor(room: BingoRoom, tier: BingoPrizeTier): number {
    if (tier === 'one_line') return room.prizes.oneLineMinor;
    if (tier === 'two_lines') return room.prizes.twoLinesMinor;
    return room.prizes.fullHouseMinor;
  }

  private async findRoom(roomId: string): Promise<BingoRoom> {
    const room = await this.bingoRoomRepository.findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('Bingo room not found');
    return room;
  }

  private toRoomResponse(room: BingoRoom, soldTickets: number): BingoRoomResponse {
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
      winMode: room.winMode ?? 'line',
      numberRange: room.numberRange ?? 90,
      patternPrizes: room.patternPrizes ?? [],
      scheduledStartAt: room.scheduledStartAt,
      drawnNumbers: room.drawnNumbers,
      settledTiers: room.settledTiers,
      winnersByTier: room.winnersByTier,
      settlementSummary: room.settlementSummary || {},
    };
  }

  private toTicketResponse(ticket: BingoTicket): BingoTicketResponse {
    return {
      id: ticket.id,
      userId: ticket.userId,
      roomId: ticket.roomId,
      grid: ticket.grid,
      markedNumbers: ticket.markedNumbers,
      completedLines: ticket.completedLines,
      wonTiers: ticket.wonTiers,
      completedPatterns: ticket.completedPatterns ?? [],
      stakeMinor: ticket.stakeMinor,
      payoutMinor: ticket.payoutMinor,
      status: ticket.status,
      settlementStatus: ticket.settlementStatus,
    };
  }

  private validateUuid(value: string, name: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) throw new BadRequestException(`${name} must be a valid UUID`);
    return value;
  }
}
