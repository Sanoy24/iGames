import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateKenoConfigDto } from './dto/create-keno-config.dto';
import { KenoRulesService } from './keno-rules.service';
import { KenoConfig } from './entities/keno-config.entity';
import { KenoDraw, KenoDrawStatus } from './entities/keno-draw.entity';
import { KenoTicket, KenoTicketStatus, KenoSettlementStatus } from './entities/keno-ticket.entity';

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
    private readonly dataSource: DataSource,
    @InjectRepository(KenoConfig)
    private readonly kenoConfigRepository: Repository<KenoConfig>,
    @InjectRepository(KenoDraw)
    private readonly kenoDrawRepository: Repository<KenoDraw>,
    @InjectRepository(KenoTicket)
    private readonly kenoTicketRepository: Repository<KenoTicket>,
    private readonly kenoRulesService: KenoRulesService,
    private readonly rngService: RngService,
    private readonly walletService: WalletService
  ) {}

  async getActiveConfig(): Promise<KenoConfig> {
    const config = await this.kenoConfigRepository.findOneBy({ status: 'active' });
    if (!config) {
      throw new NotFoundException('No active Keno config. Create one via POST /admin/keno/configs before tickets can be sold.');
    }
    return config;
  }

  async createConfig(dto: CreateKenoConfigDto): Promise<KenoConfig> {
    this.validateConfigDto(dto);
    const autoScheduleIntervalSeconds = this.normalizeAutoScheduleIntervalSeconds(dto);
    const nextVersion = await this.getNextConfigVersion();

    return this.dataSource.transaction(async (manager) => {
      const configRepo = manager.getRepository(KenoConfig);
      await configRepo.update({ status: 'active' }, { status: 'inactive' });

      const config = configRepo.create({
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
      });

      return await configRepo.save(config);
    });
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
    return this.dataSource.transaction(async (manager) => {
      const ticketRepo = manager.getRepository(KenoTicket);
      const existingTicket = await ticketRepo.findOneBy({ userId: input.userId, idempotencyKey: input.idempotencyKey });

      if (existingTicket) {
        return this.toTicketResponse(existingTicket);
      }

      const config = await this.getActiveConfigInSession(manager);
      this.kenoRulesService.validateSelectedNumbers(input.selectedNumbers, config);

      const draw = input.overrideDrawId
        ? await this.getOpenDrawById(input.overrideDrawId, manager)
        : await this.getOrCreateOpenDraw(config, manager);

      const ticket = ticketRepo.create({
        userId: input.userId,
        drawId: draw.id,
        configId: config.id,
        configVersion: config.version,
        selectedNumbers: [...input.selectedNumbers].sort((left, right) => left - right),
        stakeMinor: config.ticketPriceMinor,
        matches: 0,
        payoutMinor: 0,
        status: 'pending',
        settlementStatus: 'pending',
        idempotencyKey: input.idempotencyKey,
        isForcedWin: input.isForcedWin ?? false
      });
      await ticketRepo.save(ticket);

      const walletDebit = await this.walletService.debitInSession(
        {
          userId: input.userId,
          amountMinor: config.ticketPriceMinor,
          entryType: 'stake',
          sourceType: 'keno_ticket',
          sourceId: ticket.id,
          idempotencyKey: `keno-ticket:${input.idempotencyKey}`,
          metadata: {
            drawId: draw.id,
            selectedNumbers: ticket.selectedNumbers,
            configVersion: config.version
          }
        },
        manager
      );

      ticket.walletDebit = walletDebit;
      const saved = await ticketRepo.save(ticket);
      return this.toTicketResponse(saved);
    });
  }

  /**
   * Updates the chosen numbers on a ticket the player already paid for, while
   * its draw is still open. Used by the "pay first, then pick" flow — the spot
   * count is fixed at purchase, so only the specific numbers may change.
   */
  async updateTicketNumbers(input: {
    userId: string;
    ticketId: string;
    selectedNumbers: number[];
  }): Promise<KenoTicketResponse> {
    return this.dataSource.transaction(async (manager) => {
      const ticketRepo = manager.getRepository(KenoTicket);
      const ticket = await ticketRepo.findOneBy({ id: input.ticketId, userId: input.userId });
      if (!ticket) throw new NotFoundException('Keno ticket not found');
      if (ticket.settlementStatus !== 'pending' || ticket.status !== 'pending') {
        throw new ConflictException('Ticket can no longer be edited');
      }

      const draw = await manager.getRepository(KenoDraw).findOneBy({ id: ticket.drawId });
      if (!draw || draw.status !== 'open') {
        throw new ConflictException('Draw is locked — numbers can no longer be changed');
      }

      const config = await this.getActiveConfigInSession(manager);
      this.kenoRulesService.validateSelectedNumbers(input.selectedNumbers, config);
      if (input.selectedNumbers.length !== ticket.selectedNumbers.length) {
        throw new BadRequestException('Cannot change the number of spots after paying');
      }

      ticket.selectedNumbers = [...input.selectedNumbers].sort((left, right) => left - right);
      const saved = await ticketRepo.save(ticket);
      return this.toTicketResponse(saved);
    });
  }

  async getTicketForUser(input: {
    ticketId: string;
    userId: string;
  }): Promise<KenoTicketResponse> {
    const ticket = await this.kenoTicketRepository.findOneBy({
      id: input.ticketId,
      userId: input.userId
    });

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
    const tickets = await this.kenoTicketRepository.find({
      where: { userId: input.userId },
      order: { createdAt: 'DESC' },
      take: limit
    });

    return tickets.map((ticket) => this.toTicketResponse(ticket));
  }

  async getDrawWinners(drawId: string): Promise<{ userId: string; payoutMinor: number }[]> {
    return this.kenoTicketRepository.find({
      where: { drawId, status: 'won', settlementStatus: 'settled' },
      select: ['userId', 'payoutMinor'],
    });
  }

  async listDraws(input: { limit: number }): Promise<KenoDrawResponse[]> {
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const draws = await this.kenoDrawRepository.find({
      order: { scheduledAt: 'DESC' },
      take: limit
    });

    return draws.map((draw) => this.toDrawResponse(draw));
  }

  async findStuckDraws(thresholdMinutes = 10): Promise<string[]> {
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60000);
    const draws = await this.kenoDrawRepository.createQueryBuilder('draw')
      .where('draw.status IN (:...statuses)', { statuses: ['open', 'locked'] })
      .andWhere('draw.scheduledAt < :thresholdDate', { thresholdDate })
      .getMany();
    return draws.map(d => d.id);
  }

  async listConfigs(): Promise<KenoConfig[]> {
    return this.kenoConfigRepository.find({
      order: { version: 'DESC' }
    });
  }

  async getDraw(drawId: string): Promise<KenoDrawResponse> {
    const draw = await this.kenoDrawRepository.findOneBy({ id: drawId });
    if (!draw) {
      throw new NotFoundException('Keno draw not found');
    }
    return this.toDrawResponse(draw);
  }

  async executeDraw(drawId: string): Promise<KenoDrawResponse> {
    return this.dataSource.transaction(async (manager) => {
      const drawRepo = manager.getRepository(KenoDraw);
      const configRepo = manager.getRepository(KenoConfig);
      const ticketRepo = manager.getRepository(KenoTicket);

      const draw = await drawRepo.findOneBy({ id: drawId });

      if (!draw) {
        throw new NotFoundException('Keno draw not found');
      }
      if (draw.status === 'settled') {
        return this.toDrawResponse(draw);
      }
      if (draw.status !== 'open') {
        throw new ConflictException('Keno draw is not open');
      }

      draw.status = 'locked';
      await drawRepo.save(draw);

      const config = await configRepo.findOneBy({ version: draw.configVersion });
      if (!config) {
        throw new NotFoundException('Keno config not found for draw');
      }

      const tickets = await ticketRepo.find({
        where: { drawId: draw.id, settlementStatus: 'pending' }
      });

      const forcedTickets = tickets.filter((t) => t.isForcedWin);
        
      const mustIncludeSet = new Set<number>();
      for (const ft of forcedTickets) {
        ft.selectedNumbers.forEach((n) => mustIncludeSet.add(n));
      }

      const winChancePct = config.winChancePct ?? 100;
      if (winChancePct >= 100 && tickets.length > 0) {
        // Find the best ticket to guarantee a win for — pick the first ticket
        // and include enough of its numbers to guarantee at least the minimum
        // payout tier in the paytable.
        const targetTicket = tickets[0];
        const spotCount = targetTicket.selectedNumbers.length;
        
        // Find the minimum matches needed for a payout on this spot count
        const paytableForSpots = config.paytable
          .filter((e) => e.spots === spotCount && e.payoutMultiplier > 0)
          .sort((a, b) => a.matches - b.matches);
        
        const minMatchesNeeded = paytableForSpots.length > 0
          ? paytableForSpots[0].matches
          : 1;
        
        // Add enough of the target ticket's numbers to guarantee the minimum matches
        for (const n of targetTicket.selectedNumbers) {
          if (mustIncludeSet.size >= config.drawSize) break;
          mustIncludeSet.add(n);
          if (mustIncludeSet.size >= minMatchesNeeded) break;
        }
      }
      
      let mustInclude = Array.from(mustIncludeSet);
      if (mustInclude.length > config.drawSize) {
        mustInclude = mustInclude.slice(0, config.drawSize);
      }

      const userStreaks: Record<string, boolean> = {};
      const uniqueUserIds = Array.from(new Set(tickets.map((t) => t.userId)));
      for (const uid of uniqueUserIds) {
        userStreaks[uid] = await this.isContinuousWinner(uid, manager);
      }

      let rngResult;
      let attempts = 0;
      const maxAttempts = 15;

      do {
        rngResult = await this.rngService.drawUniqueNumbers({
          min: config.numberMin,
          max: config.numberMax,
          count: config.drawSize,
          mustInclude,
          gameType: 'keno',
          gameReference: draw.id,
          metadata: {
            configVersion: config.version,
            forcedWinsCount: forcedTickets.length,
            attempt: attempts + 1
          },
          manager
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
            if (userStreaks[ticket.userId]) {
              hasCheaterWins = true;
            }
          }
        }

        if (hasCheaterWins) {
          attempts++;
          continue;
        }

        if (hasWins && winChancePct < 100) {
          const rollResult = await this.rngService.drawUniqueNumbers({
            min: 1,
            max: 100,
            count: 1,
            gameType: 'keno',
            gameReference: draw.id,
            metadata: {
              purpose: 'win_chance_gate',
              configVersion: config.version,
              attempt: attempts + 1
            },
            manager
          });
          const roll = rollResult.numbers[0];
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
      await drawRepo.save(draw);

      await this.settleDrawTickets(draw, config, manager);
      draw.status = 'settled';
      draw.settledAt = new Date();
      await drawRepo.save(draw);

      const autoScheduleIntervalMs = this.getAutoScheduleIntervalMs(config);
      if (autoScheduleIntervalMs > 0) {
        const existingOpen = await drawRepo.findOneBy({ status: 'open' });
        if (!existingOpen) {
          const nextDrawDate = new Date(Date.now() + autoScheduleIntervalMs);
          const nextDraw = drawRepo.create({
            configId: config.id,
            configVersion: config.version,
            status: 'open',
            scheduledAt: nextDrawDate,
            drawnNumbers: [],
            settlementSummary: {}
          });
          await drawRepo.save(nextDraw);
        }
      }

      return this.toDrawResponse(draw);
    });
  }

  async findNextScheduledDraw(): Promise<KenoDrawResponse | null> {
    const draw = await this.kenoDrawRepository.findOne({
      where: {
        status: 'open',
        scheduledAt: LessThanOrEqual(new Date())
      },
      order: {
        scheduledAt: 'ASC'
      }
    });

    return draw ? this.toDrawResponse(draw) : null;
  }

  async getActiveDraw(): Promise<KenoDrawResponse | null> {
    const draw = await this.kenoDrawRepository.find({
      where: { status: In(['open', 'locked', 'drawn']) },
      order: { scheduledAt: 'ASC' },
      take: 1
    });
    return draw.length > 0 ? this.toDrawResponse(draw[0]) : null;
  }

  async executeNextOpenDraw(): Promise<KenoDrawResponse> {
    const draw = await this.kenoDrawRepository.findOne({
      where: { status: 'open' },
      order: { scheduledAt: 'ASC' }
    });

    if (!draw) {
      throw new NotFoundException('No open Keno draw found');
    }

    return this.executeDraw(draw.id);
  }

  async scheduleDraw(scheduledAt?: Date): Promise<KenoDrawResponse> {
    const config = await this.getActiveConfig();
    const autoScheduleIntervalMs = this.getAutoScheduleIntervalMs(config);
    const date = scheduledAt || new Date(Date.now() + (autoScheduleIntervalMs > 0 ? autoScheduleIntervalMs : DEFAULT_AUTO_SCHEDULE_INTERVAL_SECONDS * 1000));

    const draw = this.kenoDrawRepository.create({
      configId: config.id,
      configVersion: config.version,
      status: 'open',
      scheduledAt: date,
      drawnNumbers: [],
      settlementSummary: {}
    });
    const saved = await this.kenoDrawRepository.save(draw);

    return this.toDrawResponse(saved);
  }

  async cancelDraw(drawId: string): Promise<KenoDrawResponse> {
    return this.dataSource.transaction(async (manager) => {
      const drawRepo = manager.getRepository(KenoDraw);
      const ticketRepo = manager.getRepository(KenoTicket);

      const draw = await drawRepo.findOneBy({ id: drawId });
      if (!draw) {
        throw new NotFoundException('Keno draw not found');
      }
      if (draw.status === 'settled') {
        throw new ConflictException('Settled Keno draws cannot be cancelled');
      }
      if (draw.status === 'cancelled') {
        return this.toDrawResponse(draw);
      }

      const tickets = await ticketRepo.find({
        where: { drawId: draw.id, settlementStatus: 'pending' }
      });

      let totalRefundMinor = 0;
      for (const ticket of tickets) {
        totalRefundMinor += ticket.stakeMinor;
        ticket.status = 'cancelled';
        ticket.settlementStatus = 'settled';
        ticket.payoutMinor = 0;
        ticket.walletCredit = await this.walletService.creditInSession(
          {
            userId: ticket.userId,
            amountMinor: ticket.stakeMinor,
            entryType: 'refund',
            sourceType: 'keno_ticket',
            sourceId: ticket.id,
            idempotencyKey: `keno-refund:${ticket.id}`,
            metadata: {
              drawId: draw.id,
              reason: 'keno_draw_cancelled'
            }
          },
          manager
        );
        await ticketRepo.save(ticket);
      }

      draw.status = 'cancelled';
      draw.settledAt = new Date();
      draw.settlementSummary = {
        ticketCount: tickets.length,
        totalRefundMinor,
        reason: 'keno_draw_cancelled'
      };
      await drawRepo.save(draw);
      return this.toDrawResponse(draw);
    });
  }

  private async settleDrawTickets(
    draw: KenoDraw,
    config: KenoConfig,
    manager: EntityManager
  ): Promise<void> {
    const ticketRepo = manager.getRepository(KenoTicket);
    const tickets = await ticketRepo.find({
      where: { drawId: draw.id, settlementStatus: 'pending' }
    });

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
            userId: ticket.userId,
            amountMinor: ticket.payoutMinor,
            entryType: 'win',
            sourceType: 'keno_ticket',
            sourceId: ticket.id,
            idempotencyKey: `keno-settlement:${ticket.id}`,
            metadata: {
              drawId: draw.id,
              matches: ticket.matches,
              drawnNumbers: draw.drawnNumbers,
              selectedNumbers: ticket.selectedNumbers
            }
          },
          manager
        );
      }

      await ticketRepo.save(ticket);
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
    manager: EntityManager
  ): Promise<KenoDraw> {
    const draw = await manager.getRepository(KenoDraw).findOneBy({ id: drawId, status: 'open' });
    if (!draw) {
      throw new NotFoundException('Open Keno draw not found');
    }
    return draw;
  }

  private async getActiveConfigInSession(
    manager: EntityManager
  ): Promise<KenoConfig> {
    const config = await manager.getRepository(KenoConfig).findOneBy({ status: 'active' });
    if (!config) {
      throw new NotFoundException('No active Keno config. Create one via POST /admin/keno/configs before tickets can be sold.');
    }
    return config;
  }

  private async getOrCreateOpenDraw(
    config: KenoConfig,
    manager: EntityManager
  ): Promise<KenoDraw> {
    const drawRepo = manager.getRepository(KenoDraw);
    const existingDraw = await drawRepo.findOneBy({ status: 'open', configVersion: config.version });

    if (existingDraw) {
      return existingDraw;
    }

    const draw = drawRepo.create({
      configId: config.id,
      configVersion: config.version,
      status: 'open',
      scheduledAt: new Date(Date.now() + this.getAutoScheduleIntervalMs(config)),
      drawnNumbers: [],
      settlementSummary: {}
    });

    return await drawRepo.save(draw);
  }

  private async getNextConfigVersion(): Promise<number> {
    const latest = await this.kenoConfigRepository.findOne({
      where: {},
      order: { version: 'DESC' }
    });
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

  private toTicketResponse(ticket: KenoTicket): KenoTicketResponse {
    return {
      id: ticket.id,
      userId: ticket.userId,
      drawId: ticket.drawId,
      selectedNumbers: ticket.selectedNumbers,
      stakeMinor: ticket.stakeMinor,
      matches: ticket.matches,
      payoutMinor: ticket.payoutMinor,
      status: ticket.status,
      settlementStatus: ticket.settlementStatus,
      configVersion: ticket.configVersion,
      walletDebit: ticket.walletDebit || {},
      walletCredit: ticket.walletCredit || {}
    };
  }

  private toDrawResponse(draw: KenoDraw): KenoDrawResponse {
    return {
      id: draw.id,
      configVersion: draw.configVersion,
      status: draw.status,
      scheduledAt: draw.scheduledAt,
      drawnNumbers: draw.drawnNumbers,
      rngAuditLogId: draw.rngAuditLogId,
      settlementSummary: draw.settlementSummary || {}
    };
  }

  async isContinuousWinner(userId: string, manager?: EntityManager): Promise<boolean> {
    const repo = manager ? manager.getRepository(KenoTicket) : this.kenoTicketRepository;
    const recentTickets = await repo.find({
      where: { userId, status: In(['won', 'lost']) },
      order: { createdAt: 'DESC' },
      take: 5
    });

    if (recentTickets.length < 3) {
      return false;
    }

    const wins = recentTickets.filter((t) => t.status === 'won').length;
    if (recentTickets.length === 3 && wins === 3) return true;
    if (recentTickets.length === 4 && wins >= 3) return true;
    if (recentTickets.length === 5 && wins >= 4) return true;

    return false;
  }
}
