import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PoolMatchService } from './pool-match.service';
import { PoolMatch } from './entities/pool-match.entity';
import { PoolShot } from './entities/pool-shot.entity';
import { PoolService } from './pool.service';
import { RngService } from '../rng/rng.service';
import { ShotInput } from './engine/types';

function harness() {
  const matches = new Map<string, PoolMatch>();
  const shots: PoolShot[] = [];
  let midc = 0;
  let sidc = 0;

  const matchRepo = {
    create: (dto: Partial<PoolMatch>) => ({ ...dto }) as PoolMatch,
    save: (m: PoolMatch) => {
      if (!m.id) m.id = 'm' + ++midc;
      matches.set(m.id, m);
      return Promise.resolve(m);
    },
    findOneBy: ({ id }: { id: string }) => Promise.resolve(matches.get(id) ?? null),
  } as unknown as Repository<PoolMatch>;

  const shotRepo = {
    find: ({ where }: any) => Promise.resolve(shots.filter((s) => s.matchId === where.matchId)),
  } as unknown as Repository<PoolShot>;

  const userRepo = {
    findOne: ({ where }: any) => Promise.resolve({ id: where.id, displayName: `User ${where.id}` }),
  } as unknown as Repository<import('../users/entities/user.entity').User>;

  const insertShot = (row: any) => {
    if (shots.some((s) => s.matchId === row.matchId && s.shotIndex === row.shotIndex)) {
      const err: any = new Error('dup');
      err.code = 'ER_DUP_ENTRY';
      throw err;
    }
    shots.push({ ...row, id: 's' + ++sidc, createdAt: new Date() });
    return { identifiers: [] };
  };
  const updateMatch = (criteria: any, patch: any) => {
    const m = matches.get(criteria.id);
    const ok = !!m && (criteria.shotCount === undefined || m.shotCount === criteria.shotCount) &&
      (criteria.status === undefined || m.status === criteria.status);
    if (ok) Object.assign(m, patch);
    return { affected: ok ? 1 : 0 };
  };

  const dataSource = {
    transaction: async (cb: (m: any) => unknown) =>
      cb({
        getRepository: (E: any) => (E === PoolShot ? { insert: insertShot } : { update: updateMatch }),
      }),
  } as unknown as DataSource;

  const rng = {
    drawSeed: jest.fn().mockResolvedValue({
      numbers: [777],
      randomnessMaterialHash: 'hash',
      algorithmVersion: 'v1',
      inputHash: 'ih',
    }),
  } as unknown as RngService;

  const pool = {
    getConfig: jest.fn().mockResolvedValue({
      engineVersion: 1,
      rulesetVersion: 1,
      shotClockSeconds: 0,
      rakePct: 5,
      botDifficulty: 'medium',
      singlePlayerStakeMinor: 0,
    }),
  } as unknown as PoolService;

  const wallet = {
    debitInSession: jest.fn().mockResolvedValue({}),
    creditInSession: jest.fn().mockResolvedValue({}),
    ensureDefaultWallet: jest.fn().mockResolvedValue({}),
  } as unknown as import('../wallet/wallet.service').WalletService;

  const gateway = {
    emitPoolMatchUpdated: jest.fn(),
    emitPoolShotResolved: jest.fn(),
    emitPoolMatchEnded: jest.fn(),
    emitPoolMatchFound: jest.fn(),
  } as unknown as import('../events/game-events.gateway').GameEventsGateway;

  const bot = {
    computeShot: jest.fn().mockResolvedValue({ angle: 0, power: 0.5, spin: { side: 0, vertical: 0 } }),
  } as unknown as import('./pool-bot.service').PoolBotService;

  const tournament = {
    onMatchCompleted: jest.fn().mockResolvedValue(undefined),
  } as unknown as import('./pool-tournament.service').PoolTournamentService;

  const service = new PoolMatchService(matchRepo, shotRepo, userRepo, dataSource, rng, pool, wallet, gateway, bot, tournament);
  return { service, matches, shots, insertShot, rng, pool, wallet, gateway };
}

const BREAK: ShotInput = { angle: 0, power: 1, spin: { side: 0, vertical: 0 } };

describe('PoolMatchService', () => {
  it('creates an active, racked match on the break', async () => {
    const { service } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub', stakeMinor: 100 });
    expect(m.status).toBe('active');
    expect(m.phase).toBe('break');
    expect(m.turn).toBe('A');
    expect(m.rackSeed).toBe(777);
    expect(m.seedHash).toBe('hash');
    expect(m.board).toHaveLength(16);
    expect(m.shotCount).toBe(0);
    // physics is snapshotted onto the match so replays stay deterministic
    expect(m.physics).toBeDefined();
    expect(m.physics?.cushionReboundPct).toBe(82);
  });

  it('audits the rack draw against the created match (RngGameType pool)', async () => {
    const { service, rng } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    expect(rng.drawSeed).toHaveBeenCalledWith(
      expect.objectContaining({ gameType: 'pool', gameReference: m.id }),
    );
  });

  it('rejects a shot from a non-participant', async () => {
    const { service } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    await expect(service.submitShot(m.id, 'stranger', BREAK)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a shot when it is not the player's turn", async () => {
    const { service } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    await expect(service.submitShot(m.id, 'ub', BREAK)).rejects.toBeInstanceOf(ConflictException);
  });

  it('applies a break: persists the shot, advances state, logs the shot', async () => {
    const { service, matches, shots } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    const outcome = await service.submitShot(m.id, 'ua', BREAK);

    const updated = matches.get(m.id)!;
    expect(updated.phase).toBe('play');
    expect(updated.shotCount).toBe(1);
    expect(shots).toHaveLength(1);
    expect(shots[0].seat).toBe('A');
    expect(shots[0].shotIndex).toBe(0);
    expect(outcome.state.phase).toBe('play');
  });

  it('validates shot inputs', async () => {
    const { service } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    await expect(service.submitShot(m.id, 'ua', { angle: 0, power: 2, spin: { side: 0, vertical: 0 } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submitShot(m.id, 'ua', { angle: 0, power: 0.5, spin: { side: 3, vertical: 0 } })).rejects.toBeInstanceOf(BadRequestException);
    // cue placement without ball in hand
    await expect(
      service.submitShot(m.id, 'ua', { angle: 0, power: 0.5, spin: { side: 0, vertical: 0 }, cuePos: { x: 0.6, y: 0.6 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is idempotent: a duplicate shot index cannot double-apply', async () => {
    const { service, matches, shots } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    // Pre-seed a shot at index 0 as if it were already applied.
    shots.push({ matchId: m.id, shotIndex: 0 } as PoolShot);
    await expect(service.submitShot(m.id, 'ua', BREAK)).rejects.toBeInstanceOf(ConflictException);
    // The match state was not advanced.
    expect(matches.get(m.id)!.shotCount).toBe(0);
  });

  // ── Shot-clock timeout handling ─────────────────────────────────────────────
  const expireTurn = (m: PoolMatch) => { m.turnDeadline = new Date(Date.now() - 1000); };

  it('a timeout below the limit is a foul: turn passes, opponent gets ball in hand, no loss', async () => {
    const { service, matches, pool, gateway } = harness();
    (pool.getConfig as jest.Mock).mockResolvedValue({
      engineVersion: 1, rulesetVersion: 1, shotClockSeconds: 30, rakePct: 5, maxTimeoutFouls: 3,
    });
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub', stakeMinor: 100 });
    expireTurn(matches.get(m.id)!);

    await service.handleShotTimeout(m.id);

    const after = matches.get(m.id)!;
    expect(after.status).toBe('active');
    expect(after.turn).toBe('B');
    expect(after.ballInHand).toBe(true);
    expect(after.timeoutsA).toBe(1);
    expect(after.timeoutsB).toBe(0);
    expect(after.turnDeadline!.getTime()).toBeGreaterThan(Date.now());
    expect(gateway.emitPoolMatchEnded).not.toHaveBeenCalled();
  });

  it('reaching maxTimeoutFouls forfeits the match to the opponent and settles', async () => {
    const { service, matches, pool, wallet, gateway } = harness();
    (pool.getConfig as jest.Mock).mockResolvedValue({
      engineVersion: 1, rulesetVersion: 1, shotClockSeconds: 30, rakePct: 5, maxTimeoutFouls: 2,
    });
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub', stakeMinor: 100 });
    const stored = matches.get(m.id)!;
    stored.timeoutsA = 1; // one prior foul; this timeout is the 2nd → forfeit
    expireTurn(stored);

    await service.handleShotTimeout(m.id);

    const after = matches.get(m.id)!;
    expect(after.status).toBe('completed');
    expect(after.winnerSeat).toBe('B');
    expect(after.turnDeadline).toBeNull();
    expect(wallet.creditInSession).toHaveBeenCalled(); // winner paid
    expect(gateway.emitPoolMatchEnded).toHaveBeenCalledWith(
      m.id,
      expect.objectContaining({ winnerSeat: 'B' }),
    );
  });

  it('does nothing when the deadline has not passed', async () => {
    const { service, matches, pool, gateway } = harness();
    (pool.getConfig as jest.Mock).mockResolvedValue({
      engineVersion: 1, rulesetVersion: 1, shotClockSeconds: 30, rakePct: 5, maxTimeoutFouls: 3,
    });
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    matches.get(m.id)!.turnDeadline = new Date(Date.now() + 60_000);

    await service.handleShotTimeout(m.id);

    expect(matches.get(m.id)!.timeoutsA).toBe(0);
    expect(gateway.emitPoolMatchEnded).not.toHaveBeenCalled();
  });

  it('taking a real shot clears the shooter timeout streak', async () => {
    const { service, matches } = harness();
    const m = await service.createMatch({ mode: 'two_player', seatAUserId: 'ua', seatBUserId: 'ub' });
    matches.get(m.id)!.timeoutsA = 2;
    await service.submitShot(m.id, 'ua', BREAK);
    expect(matches.get(m.id)!.timeoutsA).toBe(0);
  });
});
