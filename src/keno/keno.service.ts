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
import { CreateKenoConfigDto } from './dto/create-keno-config.dto';
import { KenoRulesService } from './keno-rules.service';
import { KenoConfig, KenoConfigDocument } from './schemas/keno-config.schema';
import { KenoDraw, KenoDrawDocument } from './schemas/keno-draw.schema';
import { KenoTicket, KenoTicketDocument } from './schemas/keno-ticket.schema';

const DEFAULT_AUTO_SCHEDULE_INTERVAL_SECONDS = 40;

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
    if (!config) {
      throw new NotFoundException('No active Keno config. Create one via POST /admin/keno/configs before tickets can be sold.');
    }
    return config;
  }

  async createConfig(dto: CreateKenoConfigDto): Promise<KenoConfigDocument> {
    this.validateConfigDto(dto);
    const autoScheduleIntervalSeconds = this.normalizeAutoScheduleIntervalSeconds(dto);
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
              globalBotWinInterval: dto.globalBotWinInterval ?? 0,
              autoScheduleIntervalMinutes: Math.floor(autoScheduleIntervalSeconds / 60),
              autoScheduleIntervalSeconds,
              maxWinnersPerDraw: dto.maxWinnersPerDraw ?? 0,
              winChancePct: dto.winChancePct ?? 100
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

  async findStuckDraws(thresholdMinutes = 10): Promise<string[]> {
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60000);
    const draws = await this.kenoDrawModel
      .find({
        status: { $in: ['open', 'locked'] },
        scheduledAt: { $lt: thresholdDate }
      })
      .exec();
    return draws.map(d => d._id.toString());
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

        const tickets = await this.kenoTicketModel
          .find({ drawId: draw._id, settlementStatus: 'pending' })
          .session(session)
          .exec();

        const forcedTickets = tickets.filter((t) => t.isForcedWin);
          
        const mustIncludeSet = new Set<number>();
        for (const ft of forcedTickets) {
          ft.selectedNumbers.forEach((n) => mustIncludeSet.add(n));
        }
        
        let mustInclude = Array.from(mustIncludeSet);
        if (mustInclude.length > config.drawSize) {
          mustInclude = mustInclude.slice(0, config.drawSize);
        }

        const userStreaks: Record<string, boolean> = {};
        const uniqueUserIds = Array.from(new Set(tickets.map((t) => t.userId.toString())));
        for (const uid of uniqueUserIds) {
          userStreaks[uid] = await this.isContinuousWinner(new Types.ObjectId(uid), session);
        }

        let rngResult;
        let attempts = 0;
        const maxAttempts = 15;
        const winChancePct = config.winChancePct ?? 100;

        do {
          rngResult = await this.rngService.drawUniqueNumbers({
            min: config.numberMin,
            max: config.numberMax,
            count: config.drawSize,
            mustInclude,
            gameType: 'keno',
            gameReference: draw._id.toString(),
            metadata: {
              configVersion: config.version,
              forcedWinsCount: forcedTickets.length,
              attempt: attempts + 1
            },
            session
          });

          let hasWins = false;
          let hasCheaterWins = false;

          for (const ticket of tickets) {
            const matches = this.kenoRulesService.countMatches(
              ticket.selectedNumbers,
              rngResult.numbers
            );
            const payout = this.kenoRulesService.calculatePayoutMinor({
              stakeMinor: ticket.stakeMinor,
              spotCount: ticket.selectedNumbers.length,
              matches,
              config
            });

            if (payout > 0) {
              hasWins = true;
              if (userStreaks[ticket.userId.toString()]) {
                hasCheaterWins = true;
              }
            }
          }

          if (hasCheaterWins) {
            attempts++;
            continue;
          }

          if (hasWins && winChancePct < 100) {
            const roll = Math.random() * 100;
            if (roll > winChancePct) {
              attempts++;
              continue;
            }
          }

          break;
        } while (attempts < maxAttempts);

        draw.drawnNumbers = rngResult.numbers;
        draw.rngAuditLogId = rngResult.auditLogId;
        draw.executedAt = new Date();
        draw.status = 'drawn';
        await draw.save({ session });

        await this.settleDrawTickets(draw, config, session);
        draw.status = 'settled';
        draw.settledAt = new Date();
        await draw.save({ session });

        const autoScheduleIntervalMs = this.getAutoScheduleIntervalMs(config);
        if (autoScheduleIntervalMs > 0) {
          const existingOpen = await this.kenoDrawModel.findOne({ status: 'open' }).session(session).exec();
          if (!existingOpen) {
            const nextDrawDate = new Date(Date.now() + autoScheduleIntervalMs);
            await this.kenoDrawModel.create([{
              configId: config._id,
              configVersion: config.version,
              status: 'open',
              scheduledAt: nextDrawDate,
              drawnNumbers: [],
              settlementSummary: {}
            }], { session });
          }
        }

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

  async getActiveDraw(): Promise<KenoDrawResponse | null> {
    const draw = await this.kenoDrawModel
      .findOne({ status: { $in: ['open', 'locked', 'drawn'] } })
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

  async scheduleDraw(scheduledAt?: Date): Promise<KenoDrawResponse> {
    const config = await this.getActiveConfig();
    const autoScheduleIntervalMs = this.getAutoScheduleIntervalMs(config);
    const date = scheduledAt || new Date(Date.now() + (autoScheduleIntervalMs > 0 ? autoScheduleIntervalMs : DEFAULT_AUTO_SCHEDULE_INTERVAL_SECONDS * 1000));

    const [draw] = await this.kenoDrawModel.create([{
      configId: config._id,
      configVersion: config.version,
      status: 'open',
      scheduledAt: date,
      drawnNumbers: [],
      settlementSummary: {}
    }]);

    return this.toDrawResponse(draw);
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
    const maxWinners = config.maxWinnersPerDraw ?? 0;

    for (const ticket of tickets) {
      totalStakeMinor += ticket.stakeMinor;
      ticket.matches = this.kenoRulesService.countMatches(
        ticket.selectedNumbers,
        draw.drawnNumbers
      );
      const rawPayout = this.kenoRulesService.calculatePayoutMinor({
        stakeMinor: ticket.stakeMinor,
        spotCount: ticket.selectedNumbers.length,
        matches: ticket.matches,
        config
      });
      const cappedOut = maxWinners > 0 && rawPayout > 0 && winners >= maxWinners ? 0 : rawPayout;
      ticket.payoutMinor = cappedOut;
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
    if (!config) {
      throw new NotFoundException('No active Keno config. Create one via POST /admin/keno/configs before tickets can be sold.');
    }
    return config;
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
          scheduledAt: new Date(Date.now() + this.getAutoScheduleIntervalMs(config)),
          drawnNumbers: [],
          settlementSummary: {}
        }
      ],
      { session }
    );

    return draw;
  }


  private async getNextConfigVersion(): Promise<number> {
    const latest = await this.kenoConfigModel.findOne().sort({ version: -1 }).exec();
    return latest ? latest.version + 1 : 1;
  }

  getAutoScheduleIntervalMs(config: Pick<KenoConfig, 'autoScheduleIntervalMinutes' | 'autoScheduleIntervalSeconds'>): number {
    return this.getAutoScheduleIntervalSeconds(config) * 1000;
  }

  getAutoScheduleIntervalSeconds(
    config: Pick<KenoConfig, 'autoScheduleIntervalMinutes' | 'autoScheduleIntervalSeconds'>
  ): number {
    const seconds = Number(config.autoScheduleIntervalSeconds);
    if (Number.isInteger(seconds) && seconds >= 0) {
      return seconds;
    }

    const minutes = Number(config.autoScheduleIntervalMinutes);
    if (Number.isInteger(minutes) && minutes === 0) {
      return 0;
    }

    return DEFAULT_AUTO_SCHEDULE_INTERVAL_SECONDS;
  }

  private normalizeAutoScheduleIntervalSeconds(dto: CreateKenoConfigDto): number {
    if (dto.autoScheduleIntervalSeconds !== undefined) {
      return dto.autoScheduleIntervalSeconds;
    }

    if (dto.autoScheduleIntervalMinutes !== undefined) {
      return dto.autoScheduleIntervalMinutes * 60;
    }

    return DEFAULT_AUTO_SCHEDULE_INTERVAL_SECONDS;
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
    const rangeSize = numberMax - numberMin + 1;
    if (allowedSpots.some((spotCount) => spotCount > rangeSize)) {
      throw new BadRequestException('Keno allowedSpots cannot exceed number range size');
    }
    const paytableKeys = new Set<string>();
    for (const entry of dto.paytable) {
      if (entry.matches > entry.spots) {
        throw new BadRequestException('Keno paytable matches cannot exceed spots');
      }
      if (!allowedSpots.includes(entry.spots)) {
        throw new BadRequestException('Keno paytable spots must be included in allowedSpots');
      }
      const key = `${entry.spots}:${entry.matches}`;
      if (paytableKeys.has(key)) {
        throw new BadRequestException('Keno paytable entries must be unique by spots and matches');
      }
      paytableKeys.add(key);
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

  async isContinuousWinner(userId: Types.ObjectId, session?: ClientSession): Promise<boolean> {
    const recentTickets = await this.kenoTicketModel
      .find({ userId, status: { $in: ['won', 'lost'] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .session(session || null)
      .exec();

    if (recentTickets.length < 3) {
      return false;
    }

    const wins = recentTickets.filter((t) => t.status === 'won').length;
    if (recentTickets.length === 3 && wins === 3) return true;
    if (recentTickets.length === 4 && wins >= 3) return true;
    if (recentTickets.length === 5 && wins >= 4) return true;

    return false;
  }

  private toObjectId(value: string, name: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${name} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }
}
