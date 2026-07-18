import { DataSource, Repository } from 'typeorm';
import { PoolMatchmakingService } from './pool-matchmaking.service';
import { PoolQueueEntry } from './entities/pool-queue-entry.entity';
import { PoolService } from './pool.service';
import { PoolMatchService } from './pool-match.service';
import { WalletService } from '../wallet/wallet.service';
import { GameEventsGateway } from '../events/game-events.gateway';

function makeQB(result: unknown) {
  const qb: any = {};
  qb.setLock = () => qb;
  qb.where = () => qb;
  qb.andWhere = () => qb;
  qb.orderBy = () => qb;
  qb.getOne = () => Promise.resolve(result);
  return qb;
}

function harness(opponent: { userId: string; stakeMinor: number } | null) {
  const qRepo = {
    createQueryBuilder: () => makeQB(opponent),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    insert: jest.fn().mockResolvedValue({}),
  };
  const queueRepo = { findOneBy: jest.fn(), delete: jest.fn() } as unknown as Repository<PoolQueueEntry>;
  const dataSource = {
    transaction: async (cb: (m: any) => unknown) =>
      cb({ getRepository: (E: any) => (E === PoolQueueEntry ? qRepo : {}) }),
  } as unknown as DataSource;

  const poolService = {
    assertModePlayable: jest.fn().mockResolvedValue(undefined),
    getConfig: jest.fn().mockResolvedValue({ minStakeMinor: 10, maxStakeMinor: 1000 }),
  } as unknown as PoolService;

  const matchService = {
    createMatch: jest.fn().mockImplementation(async (input: any) => ({
      id: 'm1',
      seatAUserId: input.seatAUserId,
      seatBUserId: input.seatBUserId,
      stakeMinor: input.stakeMinor,
    })),
    buildView: jest.fn().mockImplementation((m: any) => ({ id: m.id })),
  } as unknown as PoolMatchService;

  const walletService = {
    ensureDefaultWallet: jest.fn().mockResolvedValue({}),
    debitInSession: jest.fn().mockResolvedValue({}),
  } as unknown as WalletService;

  const gateway = {
    emitPoolMatchFound: jest.fn(),
    emitPoolMatchUpdated: jest.fn(),
  } as unknown as GameEventsGateway;

  const service = new PoolMatchmakingService(queueRepo, dataSource, poolService, matchService, walletService, gateway);
  return { service, qRepo, matchService, walletService, gateway };
}

describe('PoolMatchmakingService', () => {
  it('enqueues when no opponent is waiting', async () => {
    const { service, qRepo, walletService } = harness(null);
    const res = await service.join('me', 100);
    expect(res).toMatchObject({ matched: false, queued: true, stakeMinor: 100 });
    expect(qRepo.insert).toHaveBeenCalledWith({ userId: 'me', stakeMinor: 100 });
    expect(walletService.debitInSession).not.toHaveBeenCalled();
  });

  it('pairs with a waiting opponent and escrows both stakes', async () => {
    const { service, matchService, walletService, gateway } = harness({ userId: 'opp', stakeMinor: 100 });
    const res = await service.join('me', 100);
    expect(res.matched).toBe(true);
    expect(matchService.createMatch).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'two_player', seatAUserId: 'opp', seatBUserId: 'me', stakeMinor: 100 }),
      expect.anything(),
    );
    // Both players are debited exactly their stake.
    expect(walletService.debitInSession).toHaveBeenCalledTimes(2);
    const amounts = (walletService.debitInSession as jest.Mock).mock.calls.map((c) => c[0].amountMinor);
    expect(amounts).toEqual([100, 100]);
    // Both players are notified.
    expect(gateway.emitPoolMatchFound).toHaveBeenCalledTimes(2);
  });

  it('rejects a stake outside the configured band', async () => {
    const { service } = harness(null);
    await expect(service.join('me', 5)).rejects.toThrow();
  });
});
