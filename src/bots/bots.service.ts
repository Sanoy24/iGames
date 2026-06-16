import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository, DataSource, EntityManager, In, MoreThan } from 'typeorm';
import { KenoService } from '../keno/keno.service';
import { User } from '../users/entities/user.entity';
import { WalletService } from '../wallet/wallet.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotPolicyDto } from './dto/update-bot-policy.dto';
import { KenoTicket } from '../keno/entities/keno-ticket.entity';
import { KenoDraw } from '../keno/entities/keno-draw.entity';

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
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

    return await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const user = userRepo.create({
        displayName: dto.displayName,
        roles: ['player'],
        status: 'active',
        productMetadata: { botPolicy: policy }
      });
      await userRepo.save(user);

      await this.walletService.ensureDefaultWallet(user.id, manager);

      const initialBalance = dto.initialBalanceMinor ?? 100000;
      await this.walletService.creditInSession(
        {
          userId: user.id,
          amountMinor: initialBalance,
          entryType: 'bonus',
          sourceType: 'bot_init',
          sourceId: user.id,
          idempotencyKey: `bot-init:${user.id}`,
          metadata: { reason: 'bot_initial_balance' }
        },
        manager
      );

      return this.toBotResponse(user);
    });
  }

  async listBots(): Promise<BotResponse[]> {
    const bots = await this.userRepository.createQueryBuilder('user')
      .where("JSON_EXTRACT(user.productMetadata, '$.botPolicy') IS NOT NULL")
      .orderBy('user.createdAt', 'DESC')
      .getMany();
    return bots.map((b) => this.toBotResponse(b));
  }

  async updatePolicy(botId: string, dto: UpdateBotPolicyDto): Promise<BotResponse> {
    const bot = await this.findBot(botId);
    const current = bot.productMetadata!.botPolicy as BotPolicy;

    const updated: BotPolicy = {
      ...current,
      ...(dto.ticketsPerRound !== undefined && { ticketsPerRound: dto.ticketsPerRound }),
      ...(dto.spotCount !== undefined && { spotCount: dto.spotCount }),
      ...(dto.active !== undefined && { active: dto.active })
    };

    bot.productMetadata = { ...bot.productMetadata!, botPolicy: updated };
    await this.userRepository.save(bot);

    return this.toBotResponse(bot);
  }

  /**
   * Called by the scheduler BEFORE a draw executes.
   * Each active bot buys tickets for the given open draw.
   */
  async buyTicketsForDraw(drawId: string): Promise<void> {
    const bots = await this.userRepository.createQueryBuilder('user')
      .where("JSON_EXTRACT(user.productMetadata, '$.botPolicy') IS NOT NULL")
      .andWhere("JSON_EXTRACT(user.productMetadata, '$.botPolicy.active') = true")
      .getMany();

    if (bots.length === 0) return;

    const config = await this.kenoService.getActiveConfig();
    const interval = config.globalBotWinInterval ?? 0;

    let forcedBotId: string | null = null;
    if (interval > 0) {
      const kenoTicketRepo = this.dataSource.getRepository(KenoTicket);
      const kenoDrawRepo = this.dataSource.getRepository(KenoDraw);
      const lastForcedTicket = await kenoTicketRepo.findOne({
        where: { isForcedWin: true },
        order: { createdAt: 'DESC' }
      });

      let drawsSinceLast = 0;
      if (lastForcedTicket) {
        const lastDraw = await kenoDrawRepo.findOneBy({ id: lastForcedTicket.drawId });
        if (lastDraw) {
          drawsSinceLast = await kenoDrawRepo.countBy({
            scheduledAt: MoreThan(lastDraw.scheduledAt),
            status: In(['open', 'locked', 'drawn', 'settled'])
          });
        }
      } else {
        drawsSinceLast = interval - 1; // trigger on first play if never won
      }

      if (drawsSinceLast >= interval - 1) {
        const luckyIndex = randomInt(0, bots.length);
        forcedBotId = bots[luckyIndex].id;
        this.logger.log(`Global interval reached (${interval}). Bot ${forcedBotId} chosen for forced win.`);
      }
    }

    for (const bot of bots) {
      try {
        const isWinRound = bot.id === forcedBotId;
        await this.buyTicketsForSingleBot(bot, drawId, isWinRound);
      } catch (error) {
        this.logger.error(
          `Bot ${bot.id} ticket purchase error`,
          error instanceof Error ? error.stack : error
        );
      }
    }
  }

  private async buyTicketsForSingleBot(bot: User, drawId: string, isForcedWin: boolean): Promise<void> {
    const policy = bot.productMetadata!.botPolicy as BotPolicy;
    const config = await this.kenoService.getActiveConfig();
    const { numberMin, numberMax, allowedSpots } = config;

    const spotCount = allowedSpots.includes(policy.spotCount)
      ? policy.spotCount
      : allowedSpots[0];

    for (let i = 0; i < policy.ticketsPerRound; i++) {
      const selectedNumbers = this.pickRandomNumbers(numberMin, numberMax, spotCount);
      const idempotencyKey = `bot-ticket:${drawId}:${bot.id}:${i}`;
      try {
        await this.kenoService.purchaseTicketForDraw({
          userId: bot.id,
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
    bot.productMetadata = { ...bot.productMetadata!, botPolicy: policy };
    await this.userRepository.save(bot);
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

  private async findBot(botId: string): Promise<User> {
    this.validateUuid(botId, 'botId');
    const bot = await this.userRepository.createQueryBuilder('user')
      .where('user.id = :botId', { botId })
      .andWhere("JSON_EXTRACT(user.productMetadata, '$.botPolicy') IS NOT NULL")
      .getOne();
    if (!bot) throw new NotFoundException('Bot not found');
    return bot;
  }

  private toBotResponse(user: User): BotResponse {
    return {
      id: user.id,
      displayName: user.displayName,
      botPolicy: user.productMetadata!.botPolicy as BotPolicy
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
