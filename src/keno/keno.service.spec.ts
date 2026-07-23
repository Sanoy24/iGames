import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { KenoService } from './keno.service';
import { KenoRulesService } from './keno-rules.service';
import { KenoTicket } from './entities/keno-ticket.entity';
import { KenoDraw } from './entities/keno-draw.entity';
import { KenoConfig } from './entities/keno-config.entity';
import { DEFAULT_KENO_PAYTABLE } from './constants/default-keno-paytable';

// ─── Fixture builders ──────────────────────────────────────────────────────────

function makeConfig(): KenoConfig {
  return Object.assign(new KenoConfig(), {
    id: 'config-1',
    name: 'Test',
    version: 1,
    status: 'active',
    allowedSpots: [1, 2, 3, 4, 5],
    numberMin: 1,
    numberMax: 80,
    drawSize: 20,
    ticketPriceMinor: 100,
    paytable: DEFAULT_KENO_PAYTABLE,
    globalBotWinInterval: 0,
    autoScheduleIntervalMinutes: 3,
    autoScheduleIntervalSeconds: 40,
    maxWinnersPerDraw: 0,
    winChancePct: 100,
  });
}

function makeTicket(overrides: Partial<KenoTicket> = {}): KenoTicket {
  return Object.assign(new KenoTicket(), {
    id: 'ticket-1',
    userId: 'user-1',
    drawId: 'draw-1',
    selectedNumbers: [1, 2, 3],
    stakeMinor: 100,
    matches: 0,
    payoutMinor: 0,
    status: 'pending',
    settlementStatus: 'pending',
    configVersion: 1,
    ...overrides,
  });
}

function makeDraw(overrides: Partial<KenoDraw> = {}): KenoDraw {
  return Object.assign(new KenoDraw(), {
    id: 'draw-1',
    configVersion: 1,
    status: 'open',
    scheduledAt: new Date(Date.now() + 60_000),
    drawnNumbers: [],
    settlementSummary: {},
    ...overrides,
  });
}

// ─── Service factory ──────────────────────────────────────────────────────────

function makeService({
  ticket,
  draw,
}: {
  ticket: KenoTicket | null;
  draw: KenoDraw | null;
}) {
  const config = makeConfig();

  const mockManager = {
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === KenoTicket) {
        return {
          findOneBy: jest.fn().mockResolvedValue(ticket),
          save: jest.fn().mockImplementation((t: KenoTicket) => Promise.resolve(t)),
        };
      }
      if (entity === KenoDraw) {
        return {
          findOneBy: jest.fn().mockResolvedValue(draw),
        };
      }
      if (entity === KenoConfig) {
        return {
          findOne: jest.fn().mockResolvedValue(config),
          findOneBy: jest.fn().mockResolvedValue(config),
        };
      }
      return {};
    }),
  } as unknown as EntityManager;

  const mockDataSource = {
    transaction: jest.fn().mockImplementation(async (cb: (m: EntityManager) => unknown) => cb(mockManager)),
  } as unknown as DataSource;

  const service = new KenoService(
    mockDataSource,
    { findOneBy: jest.fn(), findOne: jest.fn().mockResolvedValue(config) } as any,
    { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn() } as any,
    { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn() } as any,
    new KenoRulesService(),
    { drawUniqueNumbers: jest.fn() } as any,
    { debitInSession: jest.fn().mockResolvedValue({}) } as any,
    { safeCreate: jest.fn(), create: jest.fn() } as any,
    { assertPlayable: jest.fn().mockResolvedValue(undefined), isPlayable: jest.fn().mockResolvedValue(true) } as any,
  );

  return { service };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KenoService.updateTicketNumbers — unit (mocked repos)', () => {
  const validInput = {
    userId: 'user-1',
    ticketId: 'ticket-1',
    selectedNumbers: [10, 20, 30],
  };

  it('throws NotFoundException when ticket does not exist', async () => {
    const { service } = makeService({ ticket: null, draw: makeDraw() });
    await expect(service.updateTicketNumbers(validInput)).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when ticket is no longer pending (already settled)', async () => {
    const settledTicket = makeTicket({ status: 'won', settlementStatus: 'settled' });
    const { service } = makeService({ ticket: settledTicket, draw: makeDraw() });
    await expect(service.updateTicketNumbers(validInput)).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when ticket settlement is not pending', async () => {
    const ticket = makeTicket({ settlementStatus: 'settled' });
    const { service } = makeService({ ticket, draw: makeDraw() });
    await expect(service.updateTicketNumbers(validInput)).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when draw is locked (not open)', async () => {
    const ticket = makeTicket();
    const lockedDraw = makeDraw({ status: 'locked' });
    const { service } = makeService({ ticket, draw: lockedDraw });
    await expect(service.updateTicketNumbers(validInput)).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when draw has already been drawn', async () => {
    const ticket = makeTicket();
    const drawnDraw = makeDraw({ status: 'drawn' });
    const { service } = makeService({ ticket, draw: drawnDraw });
    await expect(service.updateTicketNumbers(validInput)).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when draw is null (deleted)', async () => {
    const ticket = makeTicket();
    const { service } = makeService({ ticket, draw: null });
    await expect(service.updateTicketNumbers(validInput)).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when spot count changes', async () => {
    const ticket = makeTicket({ selectedNumbers: [1, 2, 3] }); // 3 spots
    const { service } = makeService({ ticket, draw: makeDraw() });
    // 4 spots → different count → not allowed
    await expect(
      service.updateTicketNumbers({ ...validInput, selectedNumbers: [1, 2, 3, 4] })
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when a number is out of range (> 80)', async () => {
    const ticket = makeTicket({ selectedNumbers: [1, 2, 3] });
    const { service } = makeService({ ticket, draw: makeDraw() });
    await expect(
      service.updateTicketNumbers({ ...validInput, selectedNumbers: [1, 2, 81] })
    ).rejects.toThrow();
  });

  it('throws BadRequestException when numbers contain duplicates', async () => {
    const ticket = makeTicket({ selectedNumbers: [1, 2, 3] });
    const { service } = makeService({ ticket, draw: makeDraw() });
    await expect(
      service.updateTicketNumbers({ ...validInput, selectedNumbers: [1, 1, 3] })
    ).rejects.toThrow();
  });

  it('saves and returns the ticket with sorted numbers on valid input', async () => {
    const ticket = makeTicket({ selectedNumbers: [1, 2, 3] });
    const { service } = makeService({ ticket, draw: makeDraw() });
    const result = await service.updateTicketNumbers({
      ...validInput,
      selectedNumbers: [30, 10, 20], // unsorted input
    });
    expect(result.selectedNumbers).toEqual([10, 20, 30]); // saved sorted
  });

  it('does not change the number of spots (same count required)', async () => {
    const ticket = makeTicket({ selectedNumbers: [5, 15, 25] }); // 3 spots
    const { service } = makeService({ ticket, draw: makeDraw() });
    const result = await service.updateTicketNumbers({
      ...validInput,
      selectedNumbers: [7, 17, 37], // still 3 spots — valid
    });
    expect(result.selectedNumbers).toHaveLength(3);
  });
});
