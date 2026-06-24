import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource, In, LessThan, LessThanOrEqual, Not } from 'typeorm';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { BingoRulesService } from './bingo-rules.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { UpdateBingoConfigDto } from './dto/update-bingo-config.dto';
import { BingoConfig } from './entities/bingo-config.entity';
import { BingoRoom, BingoPrizeTier } from './entities/bingo-room.entity';
import { BingoTicket } from './entities/bingo-ticket.entity';

export type BingoRoomResponse = {
  id: string;
  name: string;
  status: string;
  ticketPriceMinor: number;
  maxTickets: number;
  soldTickets: number;
  prizes: Record<string, number>;
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
  stakeMinor: number;
  payoutMinor: number;
  status: string;
  settlementStatus: string;
};

const MIN_BINGO_SALES_WINDOW_MS = 60_000;

@Injectable()
export class BingoService {
  private readonly logger = new Logger(BingoService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BingoRoom)
    private readonly bingoRoomRepository: Repository<BingoRoom>,
    @InjectRepository(BingoTicket)
    private readonly bingoTicketRepository: Repository<BingoTicket>,
    @InjectRepository(BingoConfig)
    private readonly bingoConfigRepository: Repository<BingoConfig>,
    private readonly bingoRulesService: BingoRulesService,
    private readonly rngService: RngService,
    private readonly walletService: WalletService
  ) {}

  // ── Config ──────────────────────────────────────────────────────

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

  /**
   * Create the next room using the global BingoConfig defaults.
   * Called by the scheduler after a room completes.
   */
  async autoCreateNextRoom(): Promise<BingoRoomResponse | null> {
    const cfg = await this.getBingoConfig();
    if (!cfg.enabled) return null;

    // Do not create a second open room if one already exists
    const existing = await this.bingoRoomRepository.countBy({ status: 'open' });
    if (existing > 0) return null;

    // Always leave a short ticket-sales window so rooms do not auto-start
    // immediately and block players from joining.
    const delayMs = Math.max(cfg.autoRepeatIntervalMinutes * 60_000, MIN_BINGO_SALES_WINDOW_MS);
    const scheduledStartAt = new Date(Date.now() + delayMs);

    // Auto-generate a human-readable room name
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

  // ── Rooms ──────────────────────────────────────────────────────────

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
      where: {
        status: 'open',
        scheduledStartAt: LessThanOrEqual(new Date())
      }
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
      scheduledStartAt: dto.scheduledStartAt ? new Date(dto.scheduledStartAt) : new Date(),
      drawnNumbers: [],
      rngAuditLogIds: [],
      settledTiers: [],
      winnersByTier: {},
      settlementSummary: {}
    });

    await this.bingoRoomRepository.save(room);
    return this.toRoomResponse(room, 0);
  }

  async listRooms(): Promise<BingoRoomResponse[]> {
    const rooms = await this.bingoRoomRepository.find({
      order: { scheduledStartAt: 'DESC' },
      take: 100
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

    return rooms.map((room) =>
      this.toRoomResponse(room, countsByRoomId.get(room.id) ?? 0)
    );
  }

  async listTicketsForUser(input: {
    userId: string;
    limit: number;
  }): Promise<BingoTicketResponse[]> {
    this.validateUuid(input.userId, 'userId');
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const tickets = await this.bingoTicketRepository.find({
      where: { userId: input.userId },
      order: { createdAt: 'DESC' },
      take: limit
    });

    return tickets.map((ticket) => this.toTicketResponse(ticket));
  }

  async findStuckRooms(thresholdMinutes = 10): Promise<string[]> {
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60000);
    const rooms = await this.bingoRoomRepository.find({
      where: {
        status: In(['open', 'running']),
        scheduledStartAt: LessThan(thresholdDate)
      }
    });
    return rooms.map(r => r.id);
  }

  async getRoomState(input: {
    roomId: string;
    userId?: string;
  }): Promise<BingoRoomResponse & { tickets?: BingoTicketResponse[] }> {
    this.validateUuid(input.roomId, 'roomId');
    const room = await this.findRoom(input.roomId);
    const soldTickets = await this.bingoTicketRepository.countBy({ roomId: room.id });
    const response: BingoRoomResponse & { tickets?: BingoTicketResponse[] } =
      this.toRoomResponse(room, soldTickets);

    if (input.userId) {
      this.validateUuid(input.userId, 'userId');
      const tickets = await this.bingoTicketRepository.find({
        where: {
          roomId: room.id,
          userId: input.userId
        },
        order: { createdAt: 'DESC' }
      });
      response.tickets = tickets.map((ticket) => this.toTicketResponse(ticket));
    }

    return response;
  }

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
        where: { userId, roomId, purchaseIdempotencyKey: input.idempotencyKey }
      });
      if (existingTickets.length > 0) {
        return existingTickets.map((ticket) => this.toTicketResponse(ticket));
      }

      // Pessimistic write lock the room to check and modify sold tickets safely
      const room = await manager.findOne(BingoRoom, {
        where: { id: roomId },
        lock: { mode: 'pessimistic_write' }
      });

      if (!room) {
        throw new NotFoundException('Bingo room not found');
      }

      if (room.status !== 'open') {
        throw new ConflictException('Bingo room is not open for ticket sales');
      }

      if (room.soldTickets + input.count > room.maxTickets) {
        throw new ConflictException('Bingo room is full for ticket sales');
      }

      room.soldTickets += input.count;
      await manager.save(room);

      const createdTickets: BingoTicket[] = [];
      for (let index = 0; index < input.count; index += 1) {
        const ticket = manager.create(BingoTicket, {
          userId,
          roomId,
          grid: this.bingoRulesService.generateTicket(),
          markedNumbers: [],
          completedLines: [],
          wonTiers: [],
          stakeMinor: room.ticketPriceMinor,
          payoutMinor: 0,
          status: 'active',
          settlementStatus: 'pending',
          purchaseIdempotencyKey: input.idempotencyKey,
          walletCredits: []
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
            metadata: {
              roomId: room.id,
              ticketIndex: index
            }
          },
          manager
        );

        ticket.walletDebit = walletDebit;
        await manager.save(ticket);
        createdTickets.push(ticket);
      }

      return createdTickets.map((ticket) => this.toTicketResponse(ticket));
    });
  }

  async drawNextNumber(roomId: string): Promise<BingoRoomResponse> {
    const validRoomId = this.validateUuid(roomId, 'roomId');

    return await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(BingoRoom, {
        where: { id: validRoomId },
        lock: { mode: 'pessimistic_write' }
      });

      if (!room) {
        throw new NotFoundException('Bingo room not found');
      }

      if (room.status === 'completed' || room.status === 'cancelled') {
        const soldTickets = await manager.countBy(BingoTicket, { roomId: validRoomId });
        return this.toRoomResponse(room, soldTickets);
      }

      if (room.drawnNumbers.length >= 90) {
        throw new ConflictException('All Bingo numbers have already been drawn');
      }

      room.status = 'running';
      const remainingNumbers = Array.from({ length: 90 }, (_, index) => index + 1).filter(
        (number) => !room.drawnNumbers.includes(number)
      );

      const rngResult = await this.rngService.drawUniqueNumbers({
        min: 1,
        max: remainingNumbers.length,
        count: 1,
        gameType: 'bingo',
        gameReference: `${room.id}:${room.drawnNumbers.length + 1}`,
        metadata: {
          roomId: room.id,
          remainingNumbers
        },
        manager
      });

      const drawnNumber = remainingNumbers[rngResult.numbers[0] - 1];
      room.drawnNumbers.push(drawnNumber);
      if (rngResult.auditLogId) {
        room.rngAuditLogIds.push(rngResult.auditLogId);
      }

      await this.evaluateAndSettleTiers(room, manager);

      if (room.settledTiers.includes('full_house')) {
        room.status = 'completed';
        await this.markRemainingTicketsLost(room, manager);
      }

      await manager.save(room);
      const soldTickets = await manager.countBy(BingoTicket, { roomId: validRoomId });
      return this.toRoomResponse(room, soldTickets);
    });
  }

  async cancelRoom(roomId: string): Promise<BingoRoomResponse> {
    const validRoomId = this.validateUuid(roomId, 'roomId');

    return await this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(BingoRoom, {
        where: { id: validRoomId },
        lock: { mode: 'pessimistic_write' }
      });

      if (!room) {
        throw new NotFoundException('Bingo room not found');
      }

      if (room.status === 'completed') {
        throw new ConflictException('Completed Bingo rooms cannot be cancelled');
      }

      if (room.status === 'cancelled') {
        const soldTickets = await manager.countBy(BingoTicket, { roomId: validRoomId });
        return this.toRoomResponse(room, soldTickets);
      }

      const tickets = await manager.find(BingoTicket, {
        where: { roomId: room.id, settlementStatus: 'pending' }
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
            metadata: {
              roomId: room.id,
              reason: 'bingo_room_cancelled'
            }
          },
          manager
        );

        ticket.walletCredits.push(refundCredit);
        await manager.save(ticket);
      }

      room.status = 'cancelled';
      room.settlementSummary = {
        ticketCount: tickets.length,
        totalRefundMinor,
        reason: 'bingo_room_cancelled'
      };

      await manager.save(room);
      return this.toRoomResponse(room, tickets.length);
    });
  }

  private async evaluateAndSettleTiers(
    room: BingoRoom,
    manager: EntityManager
  ): Promise<void> {
    const tickets = await manager.find(BingoTicket, {
      where: { roomId: room.id, status: Not('cancelled') },
      order: { createdAt: 'ASC' }
    });

    const newlyQualifiedByTier = new Map<BingoPrizeTier, BingoTicket[]>([
      ['one_line', []],
      ['two_lines', []],
      ['full_house', []]
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
      if (winners.length === 0 || room.settledTiers.includes(tier)) {
        continue;
      }

      const shares = this.bingoRulesService.splitPrizeMinor(this.getPrizeMinor(room, tier), winners.length);
      for (const [index, ticket] of winners.entries()) {
        const share = shares[index];
        ticket.wonTiers.push(tier);
        ticket.payoutMinor += share;
        ticket.status = 'won';
        if (tier === 'full_house') {
          ticket.settlementStatus = 'settled';
        }
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
                completedLines: ticket.completedLines
              }
            },
            manager
          );
          ticket.walletCredits.push(winCredit);
        }
        await manager.save(ticket);
      }

      room.settledTiers.push(tier);
      room.winnersByTier = {
        ...room.winnersByTier,
        [tier]: winners.map((ticket) => ticket.id)
      };
      room.settlementSummary = {
        ...room.settlementSummary,
        [tier]: {
          winnerCount: winners.length,
          prizeMinor: this.getPrizeMinor(room, tier),
          shares
        }
      };
    }
  }

  private async markRemainingTicketsLost(
    room: BingoRoom,
    manager: EntityManager
  ): Promise<void> {
    await manager.update(
      BingoTicket,
      { roomId: room.id, status: 'active' },
      { status: 'lost', settlementStatus: 'settled' }
    );
  }

  private getPrizeMinor(room: BingoRoom, tier: BingoPrizeTier): number {
    if (tier === 'one_line') {
      return room.prizes.oneLineMinor;
    }
    if (tier === 'two_lines') {
      return room.prizes.twoLinesMinor;
    }
    return room.prizes.fullHouseMinor;
  }

  private async findRoom(roomId: string): Promise<BingoRoom> {
    const room = await this.bingoRoomRepository.findOneBy({ id: roomId });
    if (!room) {
      throw new NotFoundException('Bingo room not found');
    }
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
        fullHouseMinor: room.prizes.fullHouseMinor
      },
      scheduledStartAt: room.scheduledStartAt,
      drawnNumbers: room.drawnNumbers,
      settledTiers: room.settledTiers,
      winnersByTier: room.winnersByTier,
      settlementSummary: room.settlementSummary || {}
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
      stakeMinor: ticket.stakeMinor,
      payoutMinor: ticket.payoutMinor,
      status: ticket.status,
      settlementStatus: ticket.settlementStatus
    };
  }

  private validateUuid(value: string, name: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      throw new BadRequestException(`${name} must be a valid UUID`);
    }
    return value;
  }
}
