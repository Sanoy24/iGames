import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { BingoRulesService } from './bingo-rules.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { BingoPrizeTier, BingoRoom, BingoRoomDocument } from './schemas/bingo-room.schema';
import { BingoTicket, BingoTicketDocument } from './schemas/bingo-ticket.schema';

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

@Injectable()
export class BingoService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(BingoRoom.name)
    private readonly bingoRoomModel: Model<BingoRoom>,
    @InjectModel(BingoTicket.name)
    private readonly bingoTicketModel: Model<BingoTicket>,
    private readonly bingoRulesService: BingoRulesService,
    private readonly rngService: RngService,
    private readonly walletService: WalletService
  ) {}

  async listRunningRooms(): Promise<BingoRoomResponse[]> {
    const rooms = await this.bingoRoomModel.find({ status: 'running' }).exec();
    const roomIds = rooms.map((r) => r._id);
    const counts = await this.bingoTicketModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { roomId: { $in: roomIds } } },
      { $group: { _id: '$roomId', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));
    return rooms.map((room) => this.toRoomResponse(room, countMap.get(room._id.toString()) ?? 0));
  }

  async findRoomsToStart(): Promise<BingoRoomResponse[]> {
    const rooms = await this.bingoRoomModel
      .find({ status: 'open', scheduledStartAt: { $lte: new Date() } })
      .exec();
    const roomIds = rooms.map((r) => r._id);
    const counts = await this.bingoTicketModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { roomId: { $in: roomIds } } },
      { $group: { _id: '$roomId', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));
    return rooms.map((room) => this.toRoomResponse(room, countMap.get(room._id.toString()) ?? 0));
  }

  async createRoom(dto: CreateBingoRoomDto): Promise<BingoRoomResponse> {
    const [room] = await this.bingoRoomModel.create([
      {
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
      }
    ]);

    return this.toRoomResponse(room, 0);
  }

  async listRooms(): Promise<BingoRoomResponse[]> {
    const rooms = await this.bingoRoomModel
      .find()
      .sort({ scheduledStartAt: -1 })
      .limit(100)
      .exec();
    const roomIds = rooms.map((room) => room._id);
    const counts = await this.bingoTicketModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { roomId: { $in: roomIds } } },
      { $group: { _id: '$roomId', count: { $sum: 1 } } }
    ]);
    const countsByRoomId = new Map(counts.map((count) => [count._id.toString(), count.count]));

    return rooms.map((room) =>
      this.toRoomResponse(room, countsByRoomId.get(room._id.toString()) ?? 0)
    );
  }

  async listTicketsForUser(input: {
    userId: string;
    limit: number;
  }): Promise<BingoTicketResponse[]> {
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const tickets = await this.bingoTicketModel
      .find({ userId: this.toObjectId(input.userId, 'userId') })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return tickets.map((ticket) => this.toTicketResponse(ticket));
  }

  async findStuckRooms(thresholdMinutes = 10): Promise<string[]> {
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60000);
    const rooms = await this.bingoRoomModel
      .find({
        status: { $in: ['open', 'running'] },
        scheduledStartAt: { $lt: thresholdDate }
      })
      .exec();
    return rooms.map(r => r._id.toString());
  }

  async getRoomState(input: {
    roomId: string;
    userId?: string;
  }): Promise<BingoRoomResponse & { tickets?: BingoTicketResponse[] }> {
    const room = await this.findRoom(input.roomId);
    const soldTickets = await this.bingoTicketModel.countDocuments({ roomId: room._id });
    const response: BingoRoomResponse & { tickets?: BingoTicketResponse[] } =
      this.toRoomResponse(room, soldTickets);

    if (input.userId) {
      const tickets = await this.bingoTicketModel
        .find({
          roomId: room._id,
          userId: this.toObjectId(input.userId, 'userId')
        })
        .sort({ createdAt: -1 })
        .exec();
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

    const userId = this.toObjectId(input.userId, 'userId');
    const roomId = this.toObjectId(input.roomId, 'roomId');
    const session = await this.connection.startSession();

    try {
      let response: BingoTicketResponse[] | undefined;

      await session.withTransaction(async () => {
        const existingTickets = await this.bingoTicketModel
          .find({ userId, roomId, purchaseIdempotencyKey: input.idempotencyKey })
          .session(session)
          .exec();
        if (existingTickets.length > 0) {
          response = existingTickets.map((ticket) => this.toTicketResponse(ticket));
          return;
        }

        const room = await this.bingoRoomModel.findById(roomId).session(session).exec();
        if (!room) {
          throw new NotFoundException('Bingo room not found');
        }
        if (room.status !== 'open') {
          throw new ConflictException('Bingo room is not open for ticket sales');
        }

        const soldTickets = await this.bingoTicketModel
          .countDocuments({ roomId })
          .session(session);
        if (soldTickets + input.count > room.maxTickets) {
          throw new ConflictException('Bingo room ticket limit would be exceeded');
        }

        const createdTickets: BingoTicketDocument[] = [];
        for (let index = 0; index < input.count; index += 1) {
          const [ticket] = await this.bingoTicketModel.create(
            [
              {
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
              }
            ],
            { session }
          );
          const walletDebit = await this.walletService.debitInSession(
            {
              userId: input.userId,
              amountMinor: room.ticketPriceMinor,
              entryType: 'stake',
              sourceType: 'bingo_ticket',
              sourceId: ticket._id.toString(),
              idempotencyKey: `bingo-ticket:${input.idempotencyKey}:${index}`,
              metadata: {
                roomId: room._id.toString(),
                ticketIndex: index
              }
            },
            session
          );
          ticket.walletDebit = walletDebit;
          await ticket.save({ session });
          createdTickets.push(ticket);
        }

        response = createdTickets.map((ticket) => this.toTicketResponse(ticket));
      });

      if (!response) {
        throw new Error('Bingo ticket purchase transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  async drawNextNumber(roomId: string): Promise<BingoRoomResponse> {
    const objectRoomId = this.toObjectId(roomId, 'roomId');
    const session = await this.connection.startSession();

    try {
      let response: BingoRoomResponse | undefined;

      await session.withTransaction(async () => {
        const room = await this.bingoRoomModel.findById(objectRoomId).session(session).exec();
        if (!room) {
          throw new NotFoundException('Bingo room not found');
        }
        if (room.status === 'completed' || room.status === 'cancelled') {
          response = this.toRoomResponse(
            room,
            await this.bingoTicketModel.countDocuments({ roomId: objectRoomId }).session(session)
          );
          return;
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
          gameReference: `${room._id.toString()}:${room.drawnNumbers.length + 1}`,
          metadata: {
            roomId: room._id.toString(),
            remainingNumbers
          },
          session
        });
        const drawnNumber = remainingNumbers[rngResult.numbers[0] - 1];
        room.drawnNumbers.push(drawnNumber);
        if (rngResult.auditLogId) {
          room.rngAuditLogIds.push(rngResult.auditLogId);
        }

        await this.evaluateAndSettleTiers(room, session);

        if (room.settledTiers.includes('full_house')) {
          room.status = 'completed';
          await this.markRemainingTicketsLost(room, session);
        }

        await room.save({ session });
        const soldTickets = await this.bingoTicketModel
          .countDocuments({ roomId: objectRoomId })
          .session(session);
        response = this.toRoomResponse(room, soldTickets);
      });

      if (!response) {
        throw new Error('Bingo draw transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  async cancelRoom(roomId: string): Promise<BingoRoomResponse> {
    const objectRoomId = this.toObjectId(roomId, 'roomId');
    const session = await this.connection.startSession();

    try {
      let response: BingoRoomResponse | undefined;

      await session.withTransaction(async () => {
        const room = await this.bingoRoomModel.findById(objectRoomId).session(session).exec();
        if (!room) {
          throw new NotFoundException('Bingo room not found');
        }
        if (room.status === 'completed') {
          throw new ConflictException('Completed Bingo rooms cannot be cancelled');
        }
        if (room.status === 'cancelled') {
          response = this.toRoomResponse(
            room,
            await this.bingoTicketModel.countDocuments({ roomId: objectRoomId }).session(session)
          );
          return;
        }

        const tickets = await this.bingoTicketModel
          .find({ roomId: room._id, settlementStatus: 'pending' })
          .session(session)
          .exec();
        let totalRefundMinor = 0;
        for (const ticket of tickets) {
          totalRefundMinor += ticket.stakeMinor;
          ticket.status = 'cancelled';
          ticket.settlementStatus = 'settled';
          ticket.walletCredits.push(
            await this.walletService.creditInSession(
              {
                userId: ticket.userId.toString(),
                amountMinor: ticket.stakeMinor,
                entryType: 'refund',
                sourceType: 'bingo_ticket',
                sourceId: ticket._id.toString(),
                idempotencyKey: `bingo-refund:${ticket._id.toString()}`,
                metadata: {
                  roomId: room._id.toString(),
                  reason: 'bingo_room_cancelled'
                }
              },
              session
            )
          );
          await ticket.save({ session });
        }

        room.status = 'cancelled';
        room.settlementSummary = {
          ticketCount: tickets.length,
          totalRefundMinor,
          reason: 'bingo_room_cancelled'
        };
        await room.save({ session });
        response = this.toRoomResponse(room, tickets.length);
      });

      if (!response) {
        throw new Error('Bingo cancellation transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  private async evaluateAndSettleTiers(
    room: BingoRoomDocument,
    session: ClientSession
  ): Promise<void> {
    const tickets = await this.bingoTicketModel
      .find({ roomId: room._id, status: { $ne: 'cancelled' } })
      .sort({ createdAt: 1 })
      .session(session)
      .exec();
    const newlyQualifiedByTier = new Map<BingoPrizeTier, BingoTicketDocument[]>([
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
      await ticket.save({ session });
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
          ticket.walletCredits.push(
            await this.walletService.creditInSession(
              {
                userId: ticket.userId.toString(),
                amountMinor: share,
                entryType: 'win',
                sourceType: 'bingo_ticket',
                sourceId: ticket._id.toString(),
                idempotencyKey: `bingo-settlement:${tier}:${ticket._id.toString()}`,
                metadata: {
                  roomId: room._id.toString(),
                  tier,
                  drawnNumbers: room.drawnNumbers,
                  completedLines: ticket.completedLines
                }
              },
              session
            )
          );
        }
        await ticket.save({ session });
      }

      room.settledTiers.push(tier);
      room.winnersByTier = {
        ...room.winnersByTier,
        [tier]: winners.map((ticket) => ticket._id.toString())
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
    room: BingoRoomDocument,
    session: ClientSession
  ): Promise<void> {
    await this.bingoTicketModel.updateMany(
      { roomId: room._id, status: 'active' },
      { $set: { status: 'lost', settlementStatus: 'settled' } },
      { session }
    );
  }

  private getPrizeMinor(room: BingoRoomDocument, tier: BingoPrizeTier): number {
    if (tier === 'one_line') {
      return room.prizes.oneLineMinor;
    }
    if (tier === 'two_lines') {
      return room.prizes.twoLinesMinor;
    }
    return room.prizes.fullHouseMinor;
  }

  private async findRoom(roomId: string): Promise<BingoRoomDocument> {
    const room = await this.bingoRoomModel
      .findById(this.toObjectId(roomId, 'roomId'))
      .exec();
    if (!room) {
      throw new NotFoundException('Bingo room not found');
    }
    return room;
  }

  private toRoomResponse(room: BingoRoomDocument, soldTickets: number): BingoRoomResponse {
    return {
      id: room._id.toString(),
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
      settlementSummary: room.settlementSummary
    };
  }

  private toTicketResponse(ticket: BingoTicketDocument): BingoTicketResponse {
    return {
      id: ticket._id.toString(),
      userId: ticket.userId.toString(),
      roomId: ticket.roomId.toString(),
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

  private toObjectId(value: string, name: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${name} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }
}
