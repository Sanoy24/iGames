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
import { DEFAULT_KENO_PAYTABLE } from './constants/default-keno-paytable';
import { CreateKenoConfigDto } from './dto/create-keno-config.dto';
import { KenoRulesService } from './keno-rules.service';
import { KenoConfig, KenoConfigDocument } from './schemas/keno-config.schema';
import { KenoDraw, KenoDrawDocument } from './schemas/keno-draw.schema';
import { KenoTicket, KenoTicketDocument } from './schemas/keno-ticket.schema';

export type KenoTicketResponse = {
  id: string;
  userId: string;
  drawId: string;
  selectedNumbers: number[];
  stakeMinor: number;
  matches: number;
  payoutMinor: number;
  status: string;
  settlementStatus: string;
  configVersion: number;
  walletDebit?: Record<string, unknown>;
  walletCredit?: Record<string, unknown>;
};

export type KenoDrawResponse = {
  id: string;
  configVersion: number;
  status: string;
  scheduledAt: Date;
  drawnNumbers: number[];
  rngAuditLogId?: string;
  settlementSummary: Record<string, unknown>;
};

@Injectable()
export class KenoService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(KenoConfig.name)
    private readonly kenoConfigModel: Model<KenoConfig>,
    @InjectModel(KenoDraw.name)
    private readonly kenoDrawModel: Model<KenoDraw>,
    @InjectModel(KenoTicket.name)
    private readonly kenoTicketModel: Model<KenoTicket>,
    private readonly kenoRulesService: KenoRulesService,
    private readonly rngService: RngService,
    private readonly walletService: WalletService
  ) {}

  async getActiveConfig(): Promise<KenoConfigDocument> {
    const config = await this.kenoConfigModel.findOne({ status: 'active' }).exec();
    if (config) {
      return config;
    }

    return this.createDefaultConfig();
  }

  async createConfig(dto: CreateKenoConfigDto): Promise<KenoConfigDocument> {
    this.validateConfigDto(dto);
    const nextVersion = await this.getNextConfigVersion();
    const session = await this.connection.startSession();

    try {
      let config: KenoConfigDocument | undefined;

      await session.withTransaction(async () => {
        await this.kenoConfigModel.updateMany(
          { status: 'active' },
          { $set: { status: 'inactive' } },
          { session }
        );

        const [created] = await this.kenoConfigModel.create(
          [
            {
              name: dto.name,
              version: nextVersion,
              status: 'active',
              numberMin: dto.numberMin ?? 1,
              numberMax: dto.numberMax ?? 80,
              drawSize: dto.drawSize ?? 20,
              allowedSpots: dto.allowedSpots ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
              ticketPriceMinor: dto.ticketPriceMinor,
              paytable: dto.paytable,
              globalBotWinInterval: dto.globalBotWinInterval ?? 0
            }
          ],
          { session }
        );
        config = created;
      });

      if (!config) {
        throw new Error('Keno config transaction did not complete');
      }

      return config;
    } finally {
      await session.endSession();
    }
  }

  async purchaseTicketForDraw(input: {
    userId: string;
    drawId: string;
    selectedNumbers: number[];
    idempotencyKey: string;
    isForcedWin?: boolean;
  }): Promise<KenoTicketResponse> {
    return this.purchaseTicket({
      userId: input.userId,
      selectedNumbers: input.selectedNumbers,
      idempotencyKey: input.idempotencyKey,
      overrideDrawId: input.drawId,
      isForcedWin: input.isForcedWin
    });
  }

  async purchaseTicket(input: {
    userId: string;
    selectedNumbers: number[];
    idempotencyKey: string;
    overrideDrawId?: string;
    isForcedWin?: boolean;
  }): Promise<KenoTicketResponse> {
    const userId = this.toObjectId(input.userId, 'userId');
    const session = await this.connection.startSession();

    try {
      let response: KenoTicketResponse | undefined;

      await session.withTransaction(async () => {
        const existingTicket = await this.kenoTicketModel
          .findOne({ userId, idempotencyKey: input.idempotencyKey })
          .session(session)
          .exec();

        if (existingTicket) {
          response = this.toTicketResponse(existingTicket);
          return;
        }

        const config = await this.getActiveConfigInSession(session);
        this.kenoRulesService.validateSelectedNumbers(input.selectedNumbers, config);

        const draw = input.overrideDrawId
          ? await this.getOpenDrawById(input.overrideDrawId, session)
          : await this.getOrCreateOpenDraw(config, session);
        const [ticket] = await this.kenoTicketModel.create(
          [
            {
              userId,
              drawId: draw._id,
              configId: config._id,
              configVersion: config.version,
              selectedNumbers: [...input.selectedNumbers].sort((left, right) => left - right),
              stakeMinor: config.ticketPriceMinor,
              matches: 0,
              payoutMinor: 0,
              status: 'pending',
              settlementStatus: 'pending',
              idempotencyKey: input.idempotencyKey,
              isForcedWin: input.isForcedWin ?? false
            }
          ],
          { session }
        );

        const walletDebit = await this.walletService.debitInSession(
          {
            userId: input.userId,
            amountMinor: config.ticketPriceMinor,
            entryType: 'stake',
            sourceType: 'keno_ticket',
            sourceId: ticket._id.toString(),
            idempotencyKey: `keno-ticket:${input.idempotencyKey}`,
            metadata: {
              drawId: draw._id.toString(),
              selectedNumbers: ticket.selectedNumbers,
              configVersion: config.version
            }
          },
          session
        );

        ticket.walletDebit = walletDebit;
        await ticket.save({ session });
        response = this.toTicketResponse(ticket);
      });

      if (!response) {
        throw new Error('Keno ticket purchase transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  async getTicketForUser(input: {
    ticketId: string;
    userId: string;
  }): Promise<KenoTicketResponse> {
    const ticket = await this.kenoTicketModel
      .findOne({
        _id: this.toObjectId(input.ticketId, 'ticketId'),
        userId: this.toObjectId(input.userId, 'userId')
      })
      .exec();

    if (!ticket) {
      throw new NotFoundException('Keno ticket not found');
    }

    return this.toTicketResponse(ticket);
  }

  async listTicketsForUser(input: {
    userId: string;
    limit: number;
  }): Promise<KenoTicketResponse[]> {
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const tickets = await this.kenoTicketModel
      .find({ userId: this.toObjectId(input.userId, 'userId') })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return tickets.map((ticket) => this.toTicketResponse(ticket));
  }

  async listDraws(input: { limit: number }): Promise<KenoDrawResponse[]> {
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const draws = await this.kenoDrawModel
      .find()
      .sort({ scheduledAt: -1 })
      .limit(limit)
      .exec();

    return draws.map((draw) => this.toDrawResponse(draw));
  }

  async listConfigs(): Promise<KenoConfigDocument[]> {
    return this.kenoConfigModel.find().sort({ version: -1 }).exec();
  }

  async getDraw(drawId: string): Promise<KenoDrawResponse> {
    const draw = await this.kenoDrawModel
      .findById(this.toObjectId(drawId, 'drawId'))
      .exec();
    if (!draw) {
      throw new NotFoundException('Keno draw not found');
    }
    return this.toDrawResponse(draw);
  }

  async executeDraw(drawId: string): Promise<KenoDrawResponse> {
    const objectDrawId = this.toObjectId(drawId, 'drawId');
    const session = await this.connection.startSession();

    try {
      let response: KenoDrawResponse | undefined;

      await session.withTransaction(async () => {
        const draw = await this.kenoDrawModel
          .findOne({ _id: objectDrawId })
          .session(session)
          .exec();

        if (!draw) {
          throw new NotFoundException('Keno draw not found');
        }
        if (draw.status === 'settled') {
          response = this.toDrawResponse(draw);
          return;
        }
        if (draw.status !== 'open') {
          throw new ConflictException('Keno draw is not open');
        }

        draw.status = 'locked';
        await draw.save({ session });

        const config = await this.kenoConfigModel
          .findOne({ version: draw.configVersion })
          .session(session)
          .exec();
        if (!config) {
          throw new NotFoundException('Keno config not found for draw');
        }

        const forcedTickets = await this.kenoTicketModel
          .find({ drawId: draw._id, isForcedWin: true })
          .session(session)
          .exec();
          
        const mustIncludeSet = new Set<number>();
        for (const ft of forcedTickets) {
          ft.selectedNumbers.forEach((n) => mustIncludeSet.add(n));
        }
        
        let mustInclude = Array.from(mustIncludeSet);
        if (mustInclude.length > config.drawSize) {
          mustInclude = mustInclude.slice(0, config.drawSize);
        }

        const rngResult = await this.rngService.drawUniqueNumbers({
          min: config.numberMin,
          max: config.numberMax,
          count: config.drawSize,
          mustInclude,
          gameType: 'keno',
          gameReference: draw._id.toString(),
          metadata: {
            configVersion: config.version,
            forcedWinsCount: forcedTickets.length
          },
          session
        });

        draw.drawnNumbers = rngResult.numbers;
        draw.rngAuditLogId = rngResult.auditLogId;
        draw.executedAt = new Date();
        draw.status = 'drawn';
        await draw.save({ session });

        await this.settleDrawTickets(draw, config, session);
        draw.status = 'settled';
        draw.settledAt = new Date();
        await draw.save({ session });

        response = this.toDrawResponse(draw);
      });

      if (!response) {
        throw new Error('Keno draw execution transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  async findNextScheduledDraw(): Promise<KenoDrawResponse | null> {
    const draw = await this.kenoDrawModel
      .findOne({ status: 'open', scheduledAt: { $lte: new Date() } })
      .sort({ scheduledAt: 1 })
      .exec();
    return draw ? this.toDrawResponse(draw) : null;
  }

  async executeNextOpenDraw(): Promise<KenoDrawResponse> {
    const draw = await this.kenoDrawModel
      .findOne({ status: 'open' })
      .sort({ scheduledAt: 1 })
      .exec();

    if (!draw) {
      throw new NotFoundException('No open Keno draw found');
    }

    return this.executeDraw(draw._id.toString());
  }

  async cancelDraw(drawId: string): Promise<KenoDrawResponse> {
    const objectDrawId = this.toObjectId(drawId, 'drawId');
    const session = await this.connection.startSession();

    try {
      let response: KenoDrawResponse | undefined;

      await session.withTransaction(async () => {
        const draw = await this.kenoDrawModel
          .findById(objectDrawId)
          .session(session)
          .exec();
        if (!draw) {
          throw new NotFoundException('Keno draw not found');
        }
        if (draw.status === 'settled') {
          throw new ConflictException('Settled Keno draws cannot be cancelled');
        }
        if (draw.status === 'cancelled') {
          response = this.toDrawResponse(draw);
          return;
        }

        const tickets = await this.kenoTicketModel
          .find({ drawId: draw._id, settlementStatus: 'pending' })
          .session(session)
          .exec();

        let totalRefundMinor = 0;
        for (const ticket of tickets) {
          totalRefundMinor += ticket.stakeMinor;
          ticket.status = 'cancelled';
          ticket.settlementStatus = 'settled';
          ticket.payoutMinor = 0;
          ticket.walletCredit = await this.walletService.creditInSession(
            {
              userId: ticket.userId.toString(),
              amountMinor: ticket.stakeMinor,
              entryType: 'refund',
              sourceType: 'keno_ticket',
              sourceId: ticket._id.toString(),
              idempotencyKey: `keno-refund:${ticket._id.toString()}`,
              metadata: {
                drawId: draw._id.toString(),
                reason: 'keno_draw_cancelled'
              }
            },
            session
          );
          await ticket.save({ session });
        }

        draw.status = 'cancelled';
        draw.settledAt = new Date();
        draw.settlementSummary = {
          ticketCount: tickets.length,
          totalRefundMinor,
          reason: 'keno_draw_cancelled'
        };
        await draw.save({ session });
        response = this.toDrawResponse(draw);
      });

      if (!response) {
        throw new Error('Keno draw cancellation transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  private async settleDrawTickets(
    draw: KenoDrawDocument,
    config: KenoConfigDocument,
    session: ClientSession
  ): Promise<void> {
    const tickets = await this.kenoTicketModel
      .find({ drawId: draw._id, settlementStatus: 'pending' })
      .session(session)
      .exec();

    let totalStakeMinor = 0;
    let totalPayoutMinor = 0;
    let winners = 0;

    for (const ticket of tickets) {
      totalStakeMinor += ticket.stakeMinor;
      ticket.matches = this.kenoRulesService.countMatches(
        ticket.selectedNumbers,
        draw.drawnNumbers
      );
      ticket.payoutMinor = this.kenoRulesService.calculatePayoutMinor({
        stakeMinor: ticket.stakeMinor,
        spotCount: ticket.selectedNumbers.length,
        matches: ticket.matches,
        config
      });
      ticket.status = ticket.payoutMinor > 0 ? 'won' : 'lost';
      ticket.settlementStatus = 'settled';

      if (ticket.payoutMinor > 0) {
        winners += 1;
        totalPayoutMinor += ticket.payoutMinor;
        ticket.walletCredit = await this.walletService.creditInSession(
          {
            userId: ticket.userId.toString(),
            amountMinor: ticket.payoutMinor,
            entryType: 'win',
            sourceType: 'keno_ticket',
            sourceId: ticket._id.toString(),
            idempotencyKey: `keno-settlement:${ticket._id.toString()}`,
            metadata: {
              drawId: draw._id.toString(),
              matches: ticket.matches,
              drawnNumbers: draw.drawnNumbers,
              selectedNumbers: ticket.selectedNumbers
            }
          },
          session
        );
      }

      await ticket.save({ session });
    }

    draw.settlementSummary = {
      ticketCount: tickets.length,
      winners,
      totalStakeMinor,
      totalPayoutMinor
    };
  }

  private async getOpenDrawById(
    drawId: string,
    session: ClientSession
  ): Promise<KenoDrawDocument> {
    const draw = await this.kenoDrawModel
      .findOne({ _id: this.toObjectId(drawId, 'drawId'), status: 'open' })
      .session(session)
      .exec();
    if (!draw) {
      throw new NotFoundException('Open Keno draw not found');
    }
    return draw;
  }

  private async getActiveConfigInSession(
    session: ClientSession
  ): Promise<KenoConfigDocument> {
    const config = await this.kenoConfigModel
      .findOne({ status: 'active' })
      .session(session)
      .exec();
    if (config) {
      return config;
    }

    throw new NotFoundException('Active Keno config not found');
  }

  private async getOrCreateOpenDraw(
    config: KenoConfigDocument,
    session: ClientSession
  ): Promise<KenoDrawDocument> {
    const existingDraw = await this.kenoDrawModel
      .findOne({ status: 'open', configVersion: config.version })
      .session(session)
      .exec();

    if (existingDraw) {
      return existingDraw;
    }

    const [draw] = await this.kenoDrawModel.create(
      [
        {
          configId: config._id,
          configVersion: config.version,
          status: 'open',
          scheduledAt: new Date(),
          drawnNumbers: [],
          settlementSummary: {}
        }
      ],
      { session }
    );

    return draw;
  }

  private async createDefaultConfig(): Promise<KenoConfigDocument> {
    const existingConfig = await this.kenoConfigModel.findOne({ status: 'active' }).exec();
    if (existingConfig) {
      return existingConfig;
    }

    const [config] = await this.kenoConfigModel.create([
      {
        name: 'Default Keno',
        version: await this.getNextConfigVersion(),
        status: 'active',
        numberMin: 1,
        numberMax: 80,
        drawSize: 20,
        allowedSpots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        ticketPriceMinor: 100,
        paytable: DEFAULT_KENO_PAYTABLE,
        globalBotWinInterval: 0
      }
    ]);

    return config;
  }

  private async getNextConfigVersion(): Promise<number> {
    const latest = await this.kenoConfigModel.findOne().sort({ version: -1 }).exec();
    return latest ? latest.version + 1 : 1;
  }

  private validateConfigDto(dto: CreateKenoConfigDto): void {
    const numberMin = dto.numberMin ?? 1;
    const numberMax = dto.numberMax ?? 80;
    const drawSize = dto.drawSize ?? 20;
    if (numberMax <= numberMin) {
      throw new BadRequestException('Keno numberMax must be greater than numberMin');
    }
    if (drawSize > numberMax - numberMin + 1) {
      throw new BadRequestException('Keno drawSize cannot exceed number range');
    }
    const allowedSpots = dto.allowedSpots ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    if (new Set(allowedSpots).size !== allowedSpots.length) {
      throw new BadRequestException('Keno allowedSpots must be unique');
    }
  }

  private toTicketResponse(ticket: KenoTicketDocument): KenoTicketResponse {
    return {
      id: ticket._id.toString(),
      userId: ticket.userId.toString(),
      drawId: ticket.drawId.toString(),
      selectedNumbers: ticket.selectedNumbers,
      stakeMinor: ticket.stakeMinor,
      matches: ticket.matches,
      payoutMinor: ticket.payoutMinor,
      status: ticket.status,
      settlementStatus: ticket.settlementStatus,
      configVersion: ticket.configVersion,
      walletDebit: ticket.walletDebit,
      walletCredit: ticket.walletCredit
    };
  }

  private toDrawResponse(draw: KenoDrawDocument): KenoDrawResponse {
    return {
      id: draw._id.toString(),
      configVersion: draw.configVersion,
      status: draw.status,
      scheduledAt: draw.scheduledAt,
      drawnNumbers: draw.drawnNumbers,
      rngAuditLogId: draw.rngAuditLogId,
      settlementSummary: draw.settlementSummary
    };
  }

  private toObjectId(value: string, name: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${name} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }
}
