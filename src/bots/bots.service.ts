import {
  BadRequestException,
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
  walletBalanceMinor?: number;
};

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly walletService: WalletService,
    private readonly adminService: AdminService,
    private readonly kenoService: KenoService,
    private readonly bingoService: BingoService,
    private readonly crashService: CrashService,
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
    const policy = bot.productMetadata!.botPolicy as BotPolicy;
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
    const bots = await this.getActiveBots();

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
   * countdown. Tops bots up toward a time-based target (a growing fraction of their
   * eventual total allotment) instead of buying it all in one lump, so the room's
   * displayed player count / pot climb progressively through the countdown instead
   * of jumping once right before the draw starts. Once scheduledStartAt has passed,
   * the elapsed fraction naturally saturates at 1, so this same method also serves
   * as the final top-off to the full target — no separate "last minute" call needed.
   * Idempotent per increment — safe to call every second per room.
   * Returns true if any bot purchase happened this call.
   */
  async topUpBotsForOpenRoom(roomId: string): Promise<boolean> {
    const bots = await this.getActiveBots();
    if (bots.length === 0) return false;

    // ── Liquidity threshold ──────────────────────────────────────────────────
    // Bots only join while a room has FEWER than botMaxRealPlayers real players.
    // At or above it (a healthy room), bots stay out and real players compete on a
    // fair draw. 0 = bots never auto-join.
    const cfg = await this.bingoService.getBingoConfig();
    const maxReal = cfg.botMaxRealPlayers ?? 0;
    if (maxReal <= 0) return false;
    const realPlayers = await this.bingoService.countRealPlayersInRoom(roomId);
    if (realPlayers >= maxReal) return false;

    const state = await this.bingoService.getRoomState({ roomId });
    if (state.status !== 'open' || !state.scheduledStartAt || !state.soldTickets) return false;

    // ── Buy-window progress ──────────────────────────────────────────────────
    // 0 at the moment the countdown was stamped (first ticket sold), 1 at/after
    // scheduledStartAt. Drives how much of the eventual target bots should hold
    // "so far" — the delta between that and what they already hold is bought now.
    const salesWindowMs = this.bingoService.startCountdownDelayMs(cfg);
    const startAtMs = new Date(state.scheduledStartAt).getTime();
    const elapsedMs = Date.now() - (startAtMs - salesWindowMs);
    const fraction = Math.min(1, Math.max(0, elapsedMs / salesWindowMs));

    // Flooding modes buy MOST of the free cartelas so a bot wins the majority of
    // low-player rounds on a genuinely fair draw (statistical/hybrid). Off/guaranteed
    // take only a light, human-looking number (guaranteed steers at settlement).
    const flood = cfg.botWinMode === 'statistical' || cfg.botWinMode === 'hybrid';

    // Derash rooms are bought by cartela number, not by count.
    const isPrefilled = state.winMode === 'prefilled';
    const freeCartelas: number[] = [];
    if (isPrefilled) {
      const taken = new Set(state.takenSpots ?? []);
      for (let n = 1; n <= (state.gridSize ?? 75); n += 1) {
        if (!taken.has(n)) freeCartelas.push(n);
      }
      for (let i = freeCartelas.length - 1; i > 0; i -= 1) {
        const j = randomInt(0, i + 1);
        [freeCartelas[i], freeCartelas[j]] = [freeCartelas[j], freeCartelas[i]];
      }
    }

    const alreadyBoughtByBots = await this.bingoService.countBotCartelasInRoom(roomId);

    // Total cartelas bots will collectively end up with. Flood → most of the grid,
    // always leaving a buffer of free cartelas so real players can still join.
    // Otherwise → the sum of each bot's light per-round count. Pool size includes
    // what bots already hold so the target doesn't shrink as they buy into it.
    const poolSize = freeCartelas.length + alreadyBoughtByBots;
    const buffer = Math.max(5, Math.ceil(poolSize * 0.15));
    const lightTotal = bots.reduce(
      (s, b) => s + Math.min((b.productMetadata!.botPolicy as BotPolicy).ticketsPerRound ?? 1, 5),
      0,
    );
    const grabTarget = isPrefilled
      ? (flood ? Math.max(0, poolSize - buffer) : Math.min(poolSize, lightTotal))
      : lightTotal;

    const targetSoFar = Math.floor(grabTarget * fraction);
    let need = targetSoFar - alreadyBoughtByBots;
    if (need <= 0) return false;
    if (isPrefilled) need = Math.min(need, freeCartelas.length);

    let bought = false;
    let remaining = need;
    for (const bot of bots) {
      if (remaining <= 0) break;
      const policy = bot.productMetadata!.botPolicy as BotPolicy;
      const perBotCap = Math.max(1, Math.min(policy.ticketsPerRound ?? 1, 5));
      const take = Math.min(perBotCap, remaining, isPrefilled ? freeCartelas.length : remaining);
      if (take <= 0) continue;
      const ownedSoFar = await this.bingoService.countUserCartelasInRoom(bot.id, roomId);
      const idempotencyKey = `bot-bingo:${roomId}:${bot.id}:${ownedSoFar}`;
      try {
        if (isPrefilled) {
          const cartelaNumbers = freeCartelas.splice(0, take);
          if (cartelaNumbers.length === 0) continue;
          await this.bingoService.purchaseTickets({ userId: bot.id, roomId, cartelaNumbers, idempotencyKey });
          remaining -= cartelaNumbers.length;
        } else {
          await this.bingoService.purchaseTickets({ userId: bot.id, roomId, count: take, idempotencyKey });
          remaining -= take;
        }
        bought = true;
      } catch {
        // Room full, insufficient balance, or duplicate key — skip silently
      }
    }
    return bought;
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

    const bots = await this.getActiveBots();
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
    const bots = await this.getActiveBots();
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

  private async getActiveBots(): Promise<User[]> {
    return this.userRepository
      .createQueryBuilder('user')
      .where("JSON_EXTRACT(user.productMetadata, '$.botPolicy') IS NOT NULL")
      .andWhere("JSON_EXTRACT(user.productMetadata, '$.botPolicy.active') = true")
      .getMany();
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
