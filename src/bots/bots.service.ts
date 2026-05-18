import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import { KenoService } from '../keno/keno.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { WalletService } from '../wallet/wallet.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotPolicyDto } from './dto/update-bot-policy.dto';

export type BotPolicy = {
  ticketsPerRound: number;
  spotCount: number;
  drawParticipationCount: number;
  active: boolean;
};

export type BotResponse = {
  id: string;
  displayName: string;
  botPolicy: BotPolicy;
};

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly walletService: WalletService,
    private readonly kenoService: KenoService
  ) {}

  async createBot(dto: CreateBotDto): Promise<BotResponse> {
    const policy: BotPolicy = {
      ticketsPerRound: dto.ticketsPerRound ?? 1,
      spotCount: dto.spotCount ?? 3,
      drawParticipationCount: 0,
      active: true
    };

    const session = await this.connection.startSession();
    try {
      let created: UserDocument | undefined;

      await session.withTransaction(async () => {
        const [user] = await this.userModel.create(
          [
            {
              displayName: dto.displayName,
              roles: ['player'],
              status: 'active',
              productMetadata: { botPolicy: policy }
            }
          ],
          { session }
        );
        created = user;

        await this.walletService.ensureDefaultWallet(user._id, session);

        const initialBalance = dto.initialBalanceMinor ?? 100000;
        await this.walletService.creditInSession(
          {
            userId: user._id.toString(),
            amountMinor: initialBalance,
            entryType: 'bonus',
            sourceType: 'bot_init',
            sourceId: user._id.toString(),
            idempotencyKey: `bot-init:${user._id.toString()}`,
            metadata: { reason: 'bot_initial_balance' }
          },
          session
        );
      });

      if (!created) throw new Error('Bot creation transaction did not complete');
      return this.toBotResponse(created);
    } finally {
      await session.endSession();
    }
  }

  async listBots(): Promise<BotResponse[]> {
    const bots = await this.userModel
      .find({ 'productMetadata.botPolicy': { $exists: true } })
      .sort({ createdAt: -1 })
      .exec();
    return bots.map((b) => this.toBotResponse(b));
  }

  async updatePolicy(botId: string, dto: UpdateBotPolicyDto): Promise<BotResponse> {
    const bot = await this.findBot(botId);
    const current = bot.productMetadata.botPolicy as BotPolicy;

    const updated: BotPolicy = {
      ...current,
      ...(dto.ticketsPerRound !== undefined && { ticketsPerRound: dto.ticketsPerRound }),
      ...(dto.spotCount !== undefined && { spotCount: dto.spotCount }),
      ...(dto.active !== undefined && { active: dto.active })
    };

    bot.productMetadata = { ...bot.productMetadata, botPolicy: updated };
    bot.markModified('productMetadata');
    await bot.save();

    return this.toBotResponse(bot);
  }

  /**
   * Called by the scheduler BEFORE a draw executes.
   * Each active bot buys tickets for the given open draw.
   */
  async buyTicketsForDraw(drawId: string): Promise<void> {
    const bots = await this.userModel
      .find({
        'productMetadata.botPolicy': { $exists: true },
        'productMetadata.botPolicy.active': true
      })
      .exec();

    if (bots.length === 0) return;

    const config = await this.kenoService.getActiveConfig();
    const interval = config.globalBotWinInterval ?? 0;

    let forcedBotId: string | null = null;
    if (interval > 0) {
      const kenoTicketModel = this.connection.model('KenoTicket');
      const kenoDrawModel = this.connection.model('KenoDraw');
      const lastForcedTicket = await kenoTicketModel
        .findOne({ isForcedWin: true })
        .sort({ createdAt: -1 })
        .exec();

      let drawsSinceLast = 0;
      if (lastForcedTicket) {
        const lastDraw = await kenoDrawModel.findById(lastForcedTicket.drawId).exec();
        if (lastDraw) {
          drawsSinceLast = await kenoDrawModel.countDocuments({
            scheduledAt: { $gt: lastDraw.scheduledAt },
            status: { $in: ['open', 'locked', 'drawn', 'settled'] }
          });
        }
      } else {
        drawsSinceLast = interval - 1; // trigger on first play if never won
      }

      if (drawsSinceLast >= interval - 1) {
        const luckyIndex = randomInt(0, bots.length);
        forcedBotId = bots[luckyIndex]._id.toString();
        this.logger.log(`Global interval reached (${interval}). Bot ${forcedBotId} chosen for forced win.`);
      }
    }

    for (const bot of bots) {
      try {
        const isWinRound = bot._id.toString() === forcedBotId;
        await this.buyTicketsForSingleBot(bot, drawId, isWinRound);
      } catch (error) {
        this.logger.error(
          `Bot ${bot._id} ticket purchase error`,
          error instanceof Error ? error.stack : error
        );
      }
    }
  }

  private async buyTicketsForSingleBot(bot: UserDocument, drawId: string, isForcedWin: boolean): Promise<void> {
    const policy = bot.productMetadata.botPolicy as BotPolicy;
    const config = await this.kenoService.getActiveConfig();
    const { numberMin, numberMax, allowedSpots } = config;

    const spotCount = allowedSpots.includes(policy.spotCount)
      ? policy.spotCount
      : allowedSpots[0];

    for (let i = 0; i < policy.ticketsPerRound; i++) {
      const selectedNumbers = this.pickRandomNumbers(numberMin, numberMax, spotCount);
      const idempotencyKey = `bot-ticket:${drawId}:${bot._id.toString()}:${i}`;
      try {
        await this.kenoService.purchaseTicketForDraw({
          userId: bot._id.toString(),
          drawId,
          selectedNumbers,
          idempotencyKey,
          isForcedWin
        });
      } catch {
        // Already purchased (idempotent replay) or draw no longer open — skip
      }
    }

    policy.drawParticipationCount += 1;
    bot.productMetadata = { ...bot.productMetadata, botPolicy: policy };
    bot.markModified('productMetadata');
    await bot.save();
  }

  private pickRandomNumbers(min: number, max: number, count: number): number[] {
    const pool = Array.from({ length: max - min + 1 }, (_, i) => i + min);
    const picked: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = randomInt(0, pool.length);
      picked.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return picked.sort((a, b) => a - b);
  }

  private async findBot(botId: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(botId)) {
      throw new BadRequestException('botId must be a valid ObjectId');
    }
    const bot = await this.userModel
      .findOne({ _id: botId, 'productMetadata.botPolicy': { $exists: true } })
      .exec();
    if (!bot) throw new NotFoundException('Bot not found');
    return bot;
  }

  private toBotResponse(user: UserDocument): BotResponse {
    return {
      id: user._id.toString(),
      displayName: user.displayName,
      botPolicy: user.productMetadata.botPolicy as BotPolicy
    };
  }
}
