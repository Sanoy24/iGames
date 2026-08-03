import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository, DataSource, EntityManager, In, MoreThan } from 'typeorm';
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
import { BotActionLog, BotActionGame } from './entities/bot-action-log.entity';
import { BotName } from './entities/bot-name.entity';

export type BotStrategyProfile = 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
export type BotGameKey = 'keno' | 'bingo' | 'crash';

export type BotGamePolicyBase = {
  active: boolean;
  strategy: BotStrategyProfile;
  participationRatePct: number;
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
  hesitationChancePct: number;
  variancePct: number;
  minBalanceMinor: number;
  maxStakeMinorPerDay: number;
  maxLossMinorPerDay: number;
  maxWinMinorPerDay: number;
};

export type BotPolicy = {
  ticketsPerRound: number;
  spotCount: number;
  drawParticipationCount: number;
  active: boolean;
  games?: {
    keno?: BotGamePolicyBase & {
      ticketsPerRound: number;
      spotCount: number;
      drawParticipationCount: number;
    };
    bingo?: BotGamePolicyBase & {
      maxCartelasPerRoom: number;
    };
    crash?: BotGamePolicyBase & {
      minCashoutX100: number;
      maxCashoutX100: number;
    };
  };
};

export type BotPolicyInput = {
  ticketsPerRound?: number;
  spotCount?: number;
  drawParticipationCount?: number;
  active?: boolean;
  games?: {
    keno?: Partial<BotGamePolicyBase> & {
      ticketsPerRound?: number;
      spotCount?: number;
      drawParticipationCount?: number;
    };
    bingo?: Partial<BotGamePolicyBase> & {
      maxCartelasPerRoom?: number;
    };
    crash?: Partial<BotGamePolicyBase> & {
      minCashoutX100?: number;
      maxCashoutX100?: number;
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

export type BotActionLogResponse = {
  id: string;
  botId: string | null;
  game: BotActionGame;
  action: string;
  sourceId: string | null;
  amountMinor: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
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
    @InjectRepository(BotActionLog)
    private readonly botActionLogRepository: Repository<BotActionLog>,
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
          strategy: dto.kenoStrategy ?? 'normal',
          participationRatePct: dto.kenoParticipationRatePct ?? 100,
          actionDelayMinMs: dto.kenoActionDelayMinMs ?? 150,
          actionDelayMaxMs: dto.kenoActionDelayMaxMs ?? 900,
          hesitationChancePct: dto.kenoHesitationChancePct ?? 35,
          variancePct: dto.kenoVariancePct ?? 20,
          minBalanceMinor: dto.kenoMinBalanceMinor ?? 0,
          maxStakeMinorPerDay: dto.kenoMaxStakeMinorPerDay ?? 0,
          maxLossMinorPerDay: 0,
          maxWinMinorPerDay: 0,
        },
        bingo: {
          active: dto.bingoActive ?? true,
          strategy: dto.bingoStrategy ?? 'mirror-human',
          participationRatePct: dto.bingoParticipationRatePct ?? 100,
          actionDelayMinMs: dto.bingoActionDelayMinMs ?? 250,
          actionDelayMaxMs: dto.bingoActionDelayMaxMs ?? 1200,
          hesitationChancePct: dto.bingoHesitationChancePct ?? 45,
          variancePct: dto.bingoVariancePct ?? 25,
          minBalanceMinor: dto.bingoMinBalanceMinor ?? 0,
          maxStakeMinorPerDay: dto.bingoMaxStakeMinorPerDay ?? 0,
          maxLossMinorPerDay: 0,
          maxWinMinorPerDay: 0,
          maxCartelasPerRoom: dto.bingoMaxCartelasPerRoom ?? 24,
        },
        crash: {
          active: dto.crashActive ?? true,
          strategy: dto.crashStrategy ?? 'normal',
          participationRatePct: dto.crashParticipationRatePct ?? 60,
          actionDelayMinMs: dto.crashActionDelayMinMs ?? 80,
          actionDelayMaxMs: dto.crashActionDelayMaxMs ?? 600,
          hesitationChancePct: dto.crashHesitationChancePct ?? 20,
          variancePct: dto.crashVariancePct ?? 18,
          minBalanceMinor: dto.crashMinBalanceMinor ?? 0,
          maxStakeMinorPerDay: dto.crashMaxStakeMinorPerDay ?? 0,
          maxLossMinorPerDay: 0,
          maxWinMinorPerDay: 0,
          minCashoutX100: dto.crashMinCashoutX100 ?? 120,
          maxCashoutX100: dto.crashMaxCashoutX100 ?? 250,
        },
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

      await this.logBotAction(
        {
          botId: user.id,
          game: 'admin',
          action: 'bot_created',
          sourceId: user.id,
          amountMinor: initialBalance,
          metadata: { policy },
        },
        manager,
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
    const policy = this.normalizeBotPolicy(bot.productMetadata!.botPolicy as BotPolicyInput);
    bot.productMetadata = { ...bot.productMetadata!, botPolicy: { ...policy, active: false } };
    bot.status = 'suspended';
    await this.userRepository.save(bot);
    await this.logBotAction({
      botId: bot.id,
      game: 'admin',
      action: 'bot_deleted',
      sourceId: bot.id,
      metadata: { previousPolicy: policy },
    });
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
      await this.logBotAction(
        {
          botId: bot.id,
          game: 'admin',
          action: 'bot_topped_up',
          sourceId: bot.id,
          amountMinor,
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

  async listBotActions(input: {
    botId?: string;
    game?: BotActionGame;
    page?: number;
    limit?: number;
  }): Promise<{ data: BotActionLogResponse[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const qb = this.botActionLogRepository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (input.botId) {
      this.validateUuid(input.botId, 'botId');
      qb.andWhere('log.botId = :botId', { botId: input.botId });
    }
    if (input.game) {
      qb.andWhere('log.game = :game', { game: input.game });
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map((row) => this.toBotActionResponse(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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
    if (dto.displayName !== undefined) {
      const displayName = this.normalizeBotName(dto.displayName);
      if (!displayName) throw new BadRequestException('Bot name is required');
      bot.displayName = displayName;
    }
    const current = this.normalizeBotPolicy(bot.productMetadata!.botPolicy as BotPolicyInput);
    const nextKeno = {
      ...current.games!.keno!,
      ...(dto.kenoActive !== undefined && { active: dto.kenoActive }),
      ...(dto.kenoStrategy !== undefined && { strategy: dto.kenoStrategy }),
      ...(dto.kenoParticipationRatePct !== undefined && { participationRatePct: dto.kenoParticipationRatePct }),
      ...(dto.kenoActionDelayMinMs !== undefined && { actionDelayMinMs: dto.kenoActionDelayMinMs }),
      ...(dto.kenoActionDelayMaxMs !== undefined && { actionDelayMaxMs: dto.kenoActionDelayMaxMs }),
      ...(dto.kenoHesitationChancePct !== undefined && { hesitationChancePct: dto.kenoHesitationChancePct }),
      ...(dto.kenoVariancePct !== undefined && { variancePct: dto.kenoVariancePct }),
      ...(dto.kenoMinBalanceMinor !== undefined && { minBalanceMinor: dto.kenoMinBalanceMinor }),
      ...(dto.kenoMaxStakeMinorPerDay !== undefined && { maxStakeMinorPerDay: dto.kenoMaxStakeMinorPerDay }),
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
          ...(dto.bingoStrategy !== undefined && { strategy: dto.bingoStrategy }),
          ...(dto.bingoParticipationRatePct !== undefined && { participationRatePct: dto.bingoParticipationRatePct }),
          ...(dto.bingoActionDelayMinMs !== undefined && { actionDelayMinMs: dto.bingoActionDelayMinMs }),
          ...(dto.bingoActionDelayMaxMs !== undefined && { actionDelayMaxMs: dto.bingoActionDelayMaxMs }),
          ...(dto.bingoHesitationChancePct !== undefined && { hesitationChancePct: dto.bingoHesitationChancePct }),
          ...(dto.bingoVariancePct !== undefined && { variancePct: dto.bingoVariancePct }),
          ...(dto.bingoMinBalanceMinor !== undefined && { minBalanceMinor: dto.bingoMinBalanceMinor }),
          ...(dto.bingoMaxStakeMinorPerDay !== undefined && { maxStakeMinorPerDay: dto.bingoMaxStakeMinorPerDay }),
          ...(dto.bingoMaxCartelasPerRoom !== undefined && { maxCartelasPerRoom: dto.bingoMaxCartelasPerRoom }),
        },
        crash: {
          ...current.games!.crash!,
          ...(dto.crashActive !== undefined && { active: dto.crashActive }),
          ...(dto.crashStrategy !== undefined && { strategy: dto.crashStrategy }),
          ...(dto.crashParticipationRatePct !== undefined && { participationRatePct: dto.crashParticipationRatePct }),
          ...(dto.crashActionDelayMinMs !== undefined && { actionDelayMinMs: dto.crashActionDelayMinMs }),
          ...(dto.crashActionDelayMaxMs !== undefined && { actionDelayMaxMs: dto.crashActionDelayMaxMs }),
          ...(dto.crashHesitationChancePct !== undefined && { hesitationChancePct: dto.crashHesitationChancePct }),
          ...(dto.crashVariancePct !== undefined && { variancePct: dto.crashVariancePct }),
          ...(dto.crashMinBalanceMinor !== undefined && { minBalanceMinor: dto.crashMinBalanceMinor }),
          ...(dto.crashMaxStakeMinorPerDay !== undefined && { maxStakeMinorPerDay: dto.crashMaxStakeMinorPerDay }),
          ...(dto.crashMinCashoutX100 !== undefined && { minCashoutX100: dto.crashMinCashoutX100 }),
          ...(dto.crashMaxCashoutX100 !== undefined && { maxCashoutX100: dto.crashMaxCashoutX100 }),
        },
      },
    };

    const normalizedUpdated = this.normalizeBotPolicy(updated);
    bot.productMetadata = { ...bot.productMetadata!, botPolicy: normalizedUpdated };
    await this.userRepository.save(bot);
    await this.logBotAction({
      botId: bot.id,
      game: 'admin',
      action: 'policy_updated',
      sourceId: bot.id,
      metadata: { before: current, after: normalizedUpdated, patch: dto },
    });

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
    const referencePolicy = this.normalizeBotPolicy(bots[randomInt(0, bots.length)].productMetadata!.botPolicy as BotPolicyInput);
    await this.pause(this.resolveActionDelay(referencePolicy.games!.bingo!, 'bingo', 'reconcile'));
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
    const changed = await this.bingoService.reconcileBotCartelasInRoom(roomId);
    if (changed) {
      await this.logBotAction({
        botId: null,
        game: 'bingo',
        action: 'bingo_cartelas_reconciled',
        sourceId: roomId,
        metadata: { realPlayers, activeBotCount: bots.length },
      });
    }
    return changed;
  }

  /**
   * Called by the scheduler after a bingo room completes.
   * The configured policy can either pay on a fixed room interval or award a
   * random bonus win on a per-room chance basis.
   */
  async handleBingoBotWinInterval(roomId: string, policyOrInterval: number | {
    enabled?: boolean;
    mode?: 'interval' | 'random';
    everyNRounds?: number;
    chancePct?: number;
  }): Promise<void> {
    const policy = typeof policyOrInterval === 'number'
      ? {
          enabled: policyOrInterval > 0,
          mode: 'interval' as const,
          everyNRounds: Math.max(0, policyOrInterval),
          chancePct: 0,
        }
      : {
          enabled: policyOrInterval.enabled ?? true,
          mode: policyOrInterval.mode ?? 'interval',
          everyNRounds: Math.max(0, policyOrInterval.everyNRounds ?? 0),
          chancePct: Math.min(100, Math.max(0, policyOrInterval.chancePct ?? 0)),
        };
    if (!policy.enabled) return;

    const completedCount = await this.dataSource.getRepository(BingoRoom).countBy({ status: 'completed' });
    if (completedCount === 0) return;
    if (policy.mode === 'interval' && (policy.everyNRounds <= 0 || completedCount % policy.everyNRounds !== 0)) return;
    if (policy.mode === 'random' && (policy.chancePct <= 0 || randomInt(0, 100) >= policy.chancePct)) return;

    const bots = await this.getActiveBots('bingo');
    if (bots.length === 0) return;

    const luckyBot = bots[randomInt(0, bots.length)];
    const bonusAmountMinor = 50_000;

    try {
      const luckyPolicy = this.normalizeBotPolicy(luckyBot.productMetadata!.botPolicy as BotPolicyInput);
      await this.pause(this.resolveActionDelay(luckyPolicy.games!.bingo!, 'bingo', 'bonus'));
      await this.dataSource.transaction(async (manager) => {
        await this.walletService.creditInSession(
          {
            userId: luckyBot.id,
            amountMinor: bonusAmountMinor,
            entryType: 'win',
            sourceType: 'bingo_bot_win_interval',
            sourceId: roomId,
            idempotencyKey: `bingo-bot-win:${roomId}:${luckyBot.id}`,
            metadata: {
              roomId,
              completedCount,
              mode: policy.mode,
              everyNRounds: policy.everyNRounds,
              chancePct: policy.chancePct,
            },
          },
          manager,
        );
      });
      this.logger.log(
        policy.mode === 'random'
          ? `Bingo bot win bonus (random ${policy.chancePct}%): credited ${bonusAmountMinor} to bot ${luckyBot.id}`
          : `Bingo bot win bonus (every ${policy.everyNRounds} rooms): credited ${bonusAmountMinor} to bot ${luckyBot.id}`,
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
      const policy = this.normalizeBotPolicy(bot.productMetadata!.botPolicy as BotPolicyInput);
      const crashPolicy = policy.games!.crash!;
      if (!this.rollParticipation(crashPolicy.participationRatePct)) continue;
      if (!(await this.canBotEnterGame(bot, 'crash', crashPolicy, cfg.botBetMinor))) continue;

      await this.pause(this.resolveActionDelay(crashPolicy, 'crash', 'bet'));
      const idempotencyKey = `crash-bot-bet:${roundId}:${bot.id}`;
      // Bot auto-cashout: random between 1.20× and 2.50× (120–250)
      const minCashout = Math.min(crashPolicy.minCashoutX100, crashPolicy.maxCashoutX100);
      const maxCashout = Math.max(crashPolicy.minCashoutX100, crashPolicy.maxCashoutX100);
      const autoCashoutX100 = this.humanizeCrashCashout(minCashout, maxCashout, crashPolicy);

      try {
        const bet = await this.crashService.placeBet(
          bot.id,
          roundId,
          { stakeMinor: cfg.botBetMinor, autoCashoutAt: autoCashoutX100 / 100 },
          idempotencyKey,
        );
        await this.logBotAction({
          botId: bot.id,
          game: 'crash',
          action: 'crash_bet_placed',
          sourceId: bet.id,
          amountMinor: bet.stakeMinor,
          metadata: { roundId, autoCashoutX100, strategy: crashPolicy.strategy },
        });
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
    if (game === 'bingo') {
      return bots.filter(
        (bot) =>
          (bot.productMetadata!.botPolicy as BotPolicyInput).games?.bingo?.active === true &&
          this.isGameEnabled(this.normalizeBotPolicy(bot.productMetadata!.botPolicy as BotPolicyInput), game),
      );
    }
    return bots.filter((bot) => this.isGameEnabled(this.normalizeBotPolicy(bot.productMetadata!.botPolicy as BotPolicyInput), game));
  }

  private async buyTicketsForSingleBot(bot: User, drawId: string, isForcedWin: boolean): Promise<void> {
    const policy = this.normalizeBotPolicy(bot.productMetadata!.botPolicy as BotPolicyInput);
    const kenoPolicy = policy.games!.keno!;
    const config = await this.kenoService.getActiveConfig();
    const { numberMin, numberMax, allowedSpots } = config;

    if (!this.rollParticipation(kenoPolicy.participationRatePct)) return;
    if (!(await this.canBotEnterGame(bot, 'keno', kenoPolicy, config.ticketPriceMinor * kenoPolicy.ticketsPerRound))) return;

    const spotCount = allowedSpots.includes(kenoPolicy.spotCount)
      ? kenoPolicy.spotCount
      : allowedSpots[0];
    const ticketsToBuy = this.humanizeActionCount(kenoPolicy.ticketsPerRound, kenoPolicy.variancePct, 1, 6);

    await this.pause(this.resolveActionDelay(kenoPolicy, 'keno', 'purchase'));

    for (let i = 0; i < ticketsToBuy; i++) {
      if (i > 0) {
        await this.pause(this.resolveActionDelay(kenoPolicy, 'keno', 'purchase', i));
      }
      const selectedNumbers = this.pickRandomNumbers(numberMin, numberMax, spotCount);
      const idempotencyKey = `bot-ticket:${drawId}:${bot.id}:${i}`;
      try {
        const ticket = await this.kenoService.purchaseTicketForDraw({
          userId: bot.id,
          drawId,
          selectedNumbers,
          idempotencyKey,
          isForcedWin
        });
        await this.logBotAction({
          botId: bot.id,
          game: 'keno',
          action: 'keno_ticket_purchase',
          sourceId: ticket.id,
          amountMinor: ticket.stakeMinor,
          metadata: { drawId, selectedNumbers, isForcedWin, strategy: kenoPolicy.strategy },
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

  private rollParticipation(ratePct: number): boolean {
    const safeRate = Math.min(Math.max(ratePct, 0), 100);
    return safeRate >= 100 || randomInt(0, 100) < safeRate;
  }

  private humanizeActionCount(base: number, variancePct: number, min: number, max: number): number {
    const safeBase = Math.max(1, Math.floor(base));
    const spread = Math.max(0, Math.round((safeBase * Math.max(variancePct, 0)) / 100));
    const delta = spread > 0 ? randomInt(0, spread * 2 + 1) - spread : 0;
    return this.clampInt(safeBase + delta, min, max);
  }

  private resolveActionDelay(
    policy: BotGamePolicyBase,
    game: BotGameKey,
    kind: 'purchase' | 'bet' | 'reconcile' | 'bonus',
    sequenceIndex = 0,
  ): number {
    const minDelay = this.clampInt(policy.actionDelayMinMs, 0, 10_000);
    const maxDelay = this.clampInt(Math.max(policy.actionDelayMaxMs, minDelay), minDelay, 15_000);
    const baseDelay = minDelay === maxDelay ? minDelay : randomInt(minDelay, maxDelay + 1);
    const varianceWindow = Math.max(0, Math.round(baseDelay * (Math.max(policy.variancePct, 0) / 100)));
    const variance = varianceWindow > 0 ? randomInt(0, varianceWindow * 2 + 1) - varianceWindow : 0;
    const sequenceSpread = game === 'bingo' ? 140 : game === 'crash' ? 90 : 160;
    const hesitationChance = this.clampInt(policy.hesitationChancePct, 0, 100);
    const shouldHesitate = hesitationChance > 0 && randomInt(0, 100) < hesitationChance;
    const hesitation = shouldHesitate
      ? randomInt(Math.max(40, Math.floor(minDelay / 2)), Math.max(maxDelay, minDelay + 1) + 700)
      : 0;
    const kindBias = kind === 'bonus' ? 1.15 : kind === 'reconcile' ? 0.8 : kind === 'bet' ? 1.0 : 0.95;
    return this.clampInt(Math.round((baseDelay + variance + hesitation + sequenceIndex * sequenceSpread) * kindBias), 0, 8_000);
  }

  private humanizeCrashCashout(minCashoutX100: number, maxCashoutX100: number, policy: BotGamePolicyBase): number {
    const center = Math.round((minCashoutX100 + maxCashoutX100) / 2);
    const range = Math.max(1, maxCashoutX100 - minCashoutX100);
    const spread = Math.max(1, Math.round(range * Math.max(policy.variancePct, 5) / 100));
    const drift = randomInt(0, spread * 2 + 1) - spread;
    return this.clampInt(center + drift, minCashoutX100, maxCashoutX100);
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async canBotEnterGame(
    bot: User,
    game: BotGameKey,
    policy: BotGamePolicyBase,
    plannedStakeMinor: number,
  ): Promise<boolean> {
    if (policy.minBalanceMinor > 0) {
      try {
        const wallet = await this.walletService.getDefaultWalletSummary(bot.id);
        if (wallet.availableMinor < policy.minBalanceMinor) {
          await this.logBotAction({
            botId: bot.id,
            game,
            action: 'guardrail_min_balance_skip',
            metadata: { availableMinor: wallet.availableMinor, minBalanceMinor: policy.minBalanceMinor },
          });
          return false;
        }
      } catch {
        return false;
      }
    }

    if (policy.maxStakeMinorPerDay > 0) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const raw = await this.botActionLogRepository
        .createQueryBuilder('log')
        .select('COALESCE(SUM(log.amountMinor), 0)', 'total')
        .where('log.botId = :botId', { botId: bot.id })
        .andWhere('log.game = :game', { game })
        .andWhere('log.action IN (:...actions)', { actions: ['keno_ticket_purchase', 'crash_bet_placed'] })
        .andWhere('log.createdAt >= :today', { today })
        .getRawOne<{ total: string | number | null }>();
      const spentToday = Number(raw?.total ?? 0);
      if (spentToday + plannedStakeMinor > policy.maxStakeMinorPerDay) {
        await this.logBotAction({
          botId: bot.id,
          game,
          action: 'guardrail_daily_stake_skip',
          amountMinor: plannedStakeMinor,
          metadata: { spentToday, maxStakeMinorPerDay: policy.maxStakeMinorPerDay },
        });
        return false;
      }
    }

    return true;
  }

  private async logBotAction(
    input: {
      botId: string | null;
      game: BotActionGame;
      action: string;
      sourceId?: string | null;
      amountMinor?: number | null;
      metadata?: Record<string, unknown> | null;
    },
    manager?: EntityManager,
  ): Promise<void> {
    try {
      const repo = manager ? manager.getRepository(BotActionLog) : this.botActionLogRepository;
      await repo.save(repo.create({
        botId: input.botId,
        game: input.game,
        action: input.action,
        sourceId: input.sourceId ?? null,
        amountMinor: input.amountMinor ?? null,
        metadata: input.metadata ?? null,
      }));
    } catch (error) {
      this.logger.warn(`Failed to write bot action log: ${input.action}`, error instanceof Error ? error.stack : error);
    }
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
      botPolicy: this.normalizeBotPolicy(user.productMetadata!.botPolicy as BotPolicyInput)
    };
  }

  private normalizeBotPolicy(policy: BotPolicyInput = {}): BotPolicy {
    const ticketsPerRound = policy.ticketsPerRound ?? policy.games?.keno?.ticketsPerRound ?? 1;
    const spotCount = policy.spotCount ?? policy.games?.keno?.spotCount ?? 3;
    const drawParticipationCount = policy.drawParticipationCount ?? policy.games?.keno?.drawParticipationCount ?? 0;
    const active = policy.active ?? true;
    const base = (
      gamePolicy: Partial<BotGamePolicyBase> | undefined,
      defaults: {
        strategy: BotStrategyProfile;
        participationRatePct: number;
        actionDelayMinMs: number;
        actionDelayMaxMs: number;
        hesitationChancePct: number;
        variancePct: number;
      },
    ): BotGamePolicyBase => ({
      active: gamePolicy?.active ?? active,
      strategy: gamePolicy?.strategy ?? defaults.strategy,
      participationRatePct: this.clampInt(gamePolicy?.participationRatePct ?? defaults.participationRatePct, 0, 100),
      actionDelayMinMs: this.clampInt(gamePolicy?.actionDelayMinMs ?? defaults.actionDelayMinMs, 0, 10_000),
      actionDelayMaxMs: this.clampInt(
        Math.max(gamePolicy?.actionDelayMaxMs ?? defaults.actionDelayMaxMs, gamePolicy?.actionDelayMinMs ?? defaults.actionDelayMinMs),
        0,
        15_000,
      ),
      hesitationChancePct: this.clampInt(gamePolicy?.hesitationChancePct ?? defaults.hesitationChancePct, 0, 100),
      variancePct: this.clampInt(gamePolicy?.variancePct ?? defaults.variancePct, 0, 100),
      minBalanceMinor: Math.max(0, gamePolicy?.minBalanceMinor ?? 0),
      maxStakeMinorPerDay: Math.max(0, gamePolicy?.maxStakeMinorPerDay ?? 0),
      maxLossMinorPerDay: Math.max(0, gamePolicy?.maxLossMinorPerDay ?? 0),
      maxWinMinorPerDay: Math.max(0, gamePolicy?.maxWinMinorPerDay ?? 0),
    });
    const kenoBase = base(policy.games?.keno, { strategy: 'normal', participationRatePct: 100, actionDelayMinMs: 150, actionDelayMaxMs: 900, hesitationChancePct: 35, variancePct: 20 });
    const bingoBase = base(policy.games?.bingo, { strategy: 'mirror-human', participationRatePct: 100, actionDelayMinMs: 250, actionDelayMaxMs: 1200, hesitationChancePct: 45, variancePct: 25 });
    const crashBase = base(policy.games?.crash, { strategy: 'normal', participationRatePct: 60, actionDelayMinMs: 80, actionDelayMaxMs: 600, hesitationChancePct: 20, variancePct: 18 });
    const minCashoutX100 = Math.max(101, policy.games?.crash?.minCashoutX100 ?? 120);
    const maxCashoutX100 = Math.max(minCashoutX100, policy.games?.crash?.maxCashoutX100 ?? 250);
    return {
      ...policy,
      ticketsPerRound,
      spotCount,
      drawParticipationCount,
      active,
      games: {
        keno: {
          ...kenoBase,
          ticketsPerRound,
          spotCount,
          drawParticipationCount,
        },
        bingo: {
          ...bingoBase,
          maxCartelasPerRoom: this.clampInt(policy.games?.bingo?.maxCartelasPerRoom ?? 24, 1, 24),
        },
        crash: {
          ...crashBase,
          minCashoutX100,
          maxCashoutX100,
        },
      },
    };
  }

  private clampInt(value: number, min: number, max: number): number {
    return Math.min(Math.max(Math.floor(value), min), max);
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

  private toBotActionResponse(log: BotActionLog): BotActionLogResponse {
    return {
      id: log.id,
      botId: log.botId,
      game: log.game,
      action: log.action,
      sourceId: log.sourceId,
      amountMinor: log.amountMinor == null ? null : Number(log.amountMinor),
      metadata: log.metadata,
      createdAt: log.createdAt,
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


