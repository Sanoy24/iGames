import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository, DataSource, In, MoreThan } from 'typeorm';
import { KenoService } from '../keno/keno.service';
import { BingoService } from '../bingo/bingo.service';
import { CrashService } from '../crash/crash.service';
import { BingoRoom } from '../bingo/entities/bingo-room.entity';
import { User } from '../users/entities/user.entity';
import { WalletService } from '../wallet/wallet.service';
import { AdminService } from '../admin/admin.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { CreateBotNameDto, ImportBotNamesDto } from './dto/create-bot-name.dto';
import { UpdateBotPolicyDto } from './dto/update-bot-policy.dto';
import { UpdateBotNameDto } from './dto/update-bot-name.dto';
import { KenoTicket } from '../keno/entities/keno-ticket.entity';
import { KenoDraw } from '../keno/entities/keno-draw.entity';
import { BotName } from './entities/bot-name.entity';

export type BotPolicy = {
  ticketsPerRound: number;
  spotCount: number;
  drawParticipationCount: number;
  active: boolean;
  games?: {
    keno?: {
      active: boolean;
      ticketsPerRound: number;
      spotCount: number;
      drawParticipationCount: number;
    };
    bingo?: {
      active: boolean;
    };
    crash?: {
      active: boolean;
    };
  };
};

export type BotResponse = {
  id: string;
  displayName: string;
  botPolicy: BotPolicy;
  walletBalanceMinor?: number;
};

export type BotNameResponse = {
  id: string;
  displayName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(BotName)
    private readonly botNameRepository: Repository<BotName>,
    private readonly walletService: WalletService,
    private readonly adminService: AdminService,
    private readonly kenoService: KenoService,
    private readonly bingoService: BingoService,
    private readonly crashService: CrashService,
  ) {}

  async createBot(dto: CreateBotDto): Promise<BotResponse> {
    const policy = this.normalizeBotPolicy({
      ticketsPerRound: dto.ticketsPerRound ?? 1,
      spotCount: dto.spotCount ?? 3,
      drawParticipationCount: 0,
      active: true,
      games: {
        keno: {
          active: dto.kenoActive ?? true,
          ticketsPerRound: dto.ticketsPerRound ?? 1,
          spotCount: dto.spotCount ?? 3,
          drawParticipationCount: 0,
        },
        bingo: { active: dto.bingoActive ?? true },
        crash: { active: dto.crashActive ?? true },
      },
    });

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

      // Funded from the Master Wallet like every other credit — a bot's
      // bankroll is still real ETB liability sitting in the system (it can be
      // won by a real player), not free money.
      const initialBalance = dto.initialBalanceMinor ?? 100000;
      await this.adminService.creditFromMasterWallet(
        {
          targetUserId: user.id,
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

    return Promise.all(
      bots.map(async (b) => {
        let walletBalanceMinor: number | undefined;
        try {
          const ws = await this.walletService.getDefaultWalletSummary(b.id);
          walletBalanceMinor = ws.availableMinor;
        } catch { /* bot may not have a wallet yet */ }
        return { ...this.toBotResponse(b), walletBalanceMinor };
      }),
    );
  }

  async deleteBot(botId: string): Promise<void> {
    const bot = await this.findBot(botId);
    // Mark as inactive + strip bot policy so it no longer participates in games
    const policy = this.normalizeBotPolicy(bot.productMetadata!.botPolicy as Partial<BotPolicy>);
    bot.productMetadata = { ...bot.productMetadata!, botPolicy: { ...policy, active: false } };
    bot.status = 'suspended';
    await this.userRepository.save(bot);
    this.logger.log(`Bot ${botId} (${bot.displayName}) deleted`);
  }

  async topupBot(botId: string, amountMinor: number): Promise<BotResponse> {
    const bot = await this.findBot(botId);
    await this.dataSource.transaction(async (manager) => {
      // Funded from the Master Wallet — see createBot's matching comment.
      await this.adminService.creditFromMasterWallet(
        {
          targetUserId: bot.id,
          amountMinor,
          entryType: 'bonus',
          sourceType: 'bot_topup',
          sourceId: bot.id,
          idempotencyKey: `bot-topup:${bot.id}:${Date.now()}`,
          metadata: { reason: 'admin_topup' },
        },
        manager,
      );
    });
    const ws = await this.walletService.getDefaultWalletSummary(bot.id);
    return { ...this.toBotResponse(bot), walletBalanceMinor: ws.availableMinor };
  }

  async listBotNames(): Promise<BotNameResponse[]> {
    const names = await this.botNameRepository.find({
      order: { active: 'DESC', displayName: 'ASC', createdAt: 'ASC' },
    });
    return names.map((name) => this.toBotNameResponse(name));
  }

  async createBotName(dto: CreateBotNameDto): Promise<BotNameResponse> {
    const displayName = this.normalizeBotName(dto.displayName);
    if (!displayName) {
      throw new BadRequestException('Bot name is required');
    }

    const existing = await this.botNameRepository.findOneBy({ displayName });
    if (existing) {
      throw new ConflictException('Bot name already exists');
    }

    const saved = await this.botNameRepository.save(
      this.botNameRepository.create({ displayName, active: dto.active ?? true }),
    );
    return this.toBotNameResponse(saved);
  }

  async importBotNames(dto: ImportBotNamesDto): Promise<BotNameResponse[]> {
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

  async updateBotName(id: string, dto: UpdateBotNameDto): Promise<BotNameResponse> {
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

  async updatePolicy(botId: string, dto: UpdateBotPolicyDto): Promise<BotResponse> {
    const bot = await this.findBot(botId);
    const current = this.normalizeBotPolicy(bot.productMetadata!.botPolicy as Partial<BotPolicy>);
    const nextKeno = {
      ...current.games!.keno!,
      ...(dto.kenoActive !== undefined && { active: dto.kenoActive }),
      ...(dto.ticketsPerRound !== undefined && { ticketsPerRound: dto.ticketsPerRound }),
      ...(dto.spotCount !== undefined && { spotCount: dto.spotCount }),
    };

    const updated: BotPolicy = {
      ...current,
      ...(dto.ticketsPerRound !== undefined && { ticketsPerRound: dto.ticketsPerRound }),
      ...(dto.spotCount !== undefined && { spotCount: dto.spotCount }),
      ...(dto.active !== undefined && { active: dto.active }),
      games: {
        ...current.games,
        keno: nextKeno,
        bingo: {
          ...current.games!.bingo!,
          ...(dto.bingoActive !== undefined && { active: dto.bingoActive }),
        },
        crash: {
          ...current.games!.crash!,
          ...(dto.crashActive !== undefined && { active: dto.crashActive }),
        },
      },
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
    const bots = await this.getActiveBots('keno');

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

  /**
   * Called by the scheduler on every tick for open rooms with an active buy-window
   * countdown. Bot demand is delegated to BingoService so the same live human-
   * demand rule handles bot buys, bot refunds, and the final freeze window.
   * Returns true if any bot purchase or refund happened this call.
   */
  async topUpBotsForOpenRoom(roomId: string): Promise<boolean> {
    const bots = await this.getActiveBots('bingo');
    if (bots.length === 0) return false;
    const realPlayers = await this.bingoService.countRealPlayersInRoom(roomId);
    if (realPlayers <= 0) {
      let cancelled = false;
      try {
        await this.bingoService.cancelRoom(roomId);
        cancelled = true;
      } catch (error) {
        this.logger.warn(
          `Failed to cancel bot-only Bingo room ${roomId}`,
          error instanceof Error ? error.stack : error,
        );
      }
      return cancelled;
    }
    return this.bingoService.reconcileBotCartelasInRoom(roomId);
  }

  /**
   * Called by the scheduler after a bingo room completes.
   * If the completed-room count is a multiple of `interval`, a random active bot
   * receives a bonus win credit (posted-room win, no draw rigging needed).
   */
  async handleBingoBotWinInterval(roomId: string, interval: number): Promise<void> {
    if (interval <= 0) return;

    const completedCount = await this.dataSource.getRepository(BingoRoom).countBy({ status: 'completed' });
    if (completedCount === 0 || completedCount % interval !== 0) return;

    const bots = await this.getActiveBots('bingo');
    if (bots.length === 0) return;

    const luckyBot = bots[randomInt(0, bots.length)];
    const bonusAmountMinor = 50_000;

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.walletService.creditInSession(
          {
            userId: luckyBot.id,
            amountMinor: bonusAmountMinor,
            entryType: 'win',
            sourceType: 'bingo_bot_win_interval',
            sourceId: roomId,
            idempotencyKey: `bingo-bot-win:${roomId}:${luckyBot.id}`,
            metadata: { roomId, completedCount, interval },
          },
          manager,
        );
      });
      this.logger.log(
        `Bingo bot win interval (every ${interval} rooms): credited ${bonusAmountMinor} to bot ${luckyBot.id}`,
      );
    } catch (err) {
      this.logger.error(`Failed to credit bot win for room ${roomId}`, err instanceof Error ? err.stack : err);
    }
  }

  /**
   * Called by the crash scheduler right after a new round enters the waiting phase.
   * Each active bot randomly decides to participate (~60% chance) and places one bet.
   */
  async placeBetsForCrashRound(roundId: string): Promise<void> {
    const bots = await this.getActiveBots('crash');
    if (bots.length === 0) return;

    const cfg = await this.crashService.getConfig();
    if (!cfg.enabled || cfg.botBetMinor <= 0) return;

    for (const bot of bots) {
      // ~60% participation rate per round
      if (randomInt(0, 10) >= 6) continue;

      const idempotencyKey = `crash-bot-bet:${roundId}:${bot.id}`;
      // Bot auto-cashout: random between 1.20× and 2.50× (120–250)
      const autoCashoutX100 = 120 + randomInt(0, 131);

      try {
        await this.crashService.placeBet(
          bot.id,
          roundId,
          { stakeMinor: cfg.botBetMinor, autoCashoutAt: autoCashoutX100 / 100 },
          idempotencyKey,
        );
      } catch {
        // Duplicate key, insufficient balance, or round no longer waiting — skip silently
      }
    }
  }

  private async getActiveBots(game?: 'keno' | 'bingo' | 'crash'): Promise<User[]> {
    const bots = await this.userRepository
      .createQueryBuilder('user')
      .where("JSON_EXTRACT(user.productMetadata, '$.botPolicy') IS NOT NULL")
      .andWhere("JSON_EXTRACT(user.productMetadata, '$.botPolicy.active') = true")
      .getMany();
    if (!game) return bots;
    return bots.filter((bot) => this.isGameEnabled(this.normalizeBotPolicy(bot.productMetadata!.botPolicy as Partial<BotPolicy>), game));
  }

  private async buyTicketsForSingleBot(bot: User, drawId: string, isForcedWin: boolean): Promise<void> {
    const policy = this.normalizeBotPolicy(bot.productMetadata!.botPolicy as Partial<BotPolicy>);
    const kenoPolicy = policy.games!.keno!;
    const config = await this.kenoService.getActiveConfig();
    const { numberMin, numberMax, allowedSpots } = config;

    const spotCount = allowedSpots.includes(kenoPolicy.spotCount)
      ? kenoPolicy.spotCount
      : allowedSpots[0];

    for (let i = 0; i < kenoPolicy.ticketsPerRound; i++) {
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

    kenoPolicy.drawParticipationCount += 1;
    policy.drawParticipationCount = kenoPolicy.drawParticipationCount;
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
      botPolicy: this.normalizeBotPolicy(user.productMetadata!.botPolicy as Partial<BotPolicy>)
    };
  }

  private normalizeBotPolicy(policy: Partial<BotPolicy> = {}): BotPolicy {
    const ticketsPerRound = policy.ticketsPerRound ?? policy.games?.keno?.ticketsPerRound ?? 1;
    const spotCount = policy.spotCount ?? policy.games?.keno?.spotCount ?? 3;
    const drawParticipationCount = policy.drawParticipationCount ?? policy.games?.keno?.drawParticipationCount ?? 0;
    const active = policy.active ?? true;
    return {
      ...policy,
      ticketsPerRound,
      spotCount,
      drawParticipationCount,
      active,
      games: {
        keno: {
          active: policy.games?.keno?.active ?? active,
          ticketsPerRound,
          spotCount,
          drawParticipationCount,
        },
        bingo: { active: policy.games?.bingo?.active ?? active },
        crash: { active: policy.games?.crash?.active ?? active },
      },
    };
  }

  private isGameEnabled(policy: BotPolicy, game: 'keno' | 'bingo' | 'crash'): boolean {
    return policy.active !== false && policy.games?.[game]?.active !== false;
  }

  private normalizeBotName(displayName: string): string {
    return (displayName ?? '').trim().replace(/\s+/g, ' ');
  }

  private toBotNameResponse(name: BotName): BotNameResponse {
    return {
      id: name.id,
      displayName: name.displayName,
      active: name.active,
      createdAt: name.createdAt,
      updatedAt: name.updatedAt,
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


