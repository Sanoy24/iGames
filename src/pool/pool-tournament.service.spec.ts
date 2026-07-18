import { DataSource, Repository } from 'typeorm';
import { PoolTournamentService } from './pool-tournament.service';
import { PoolTournament } from './entities/pool-tournament.entity';
import { PoolTournamentPlayer } from './entities/pool-tournament-player.entity';
import { PoolMatch } from './entities/pool-match.entity';
import { PoolService } from './pool.service';
import { PoolMatchService } from './pool-match.service';
import { WalletService } from '../wallet/wallet.service';
import { RngService } from '../rng/rng.service';

function harness(opts: {
  tournament: Partial<PoolTournament>;
  sibling?: Partial<PoolMatch> | null;
}) {
  const tournamentRepo = {
    findOneBy: jest.fn().mockResolvedValue(opts.tournament),
  } as unknown as Repository<PoolTournament>;

  const playerRepo = { update: jest.fn().mockResolvedValue({}) } as unknown as Repository<PoolTournamentPlayer>;

  const matchRepo = {
    findOne: jest.fn().mockResolvedValue(opts.sibling ?? null),
  } as unknown as Repository<PoolMatch>;

  const tRepoTx = {
    findOne: jest.fn().mockResolvedValue(opts.tournament),
    update: jest.fn().mockResolvedValue({}),
  };
  const dataSource = {
    transaction: async (cb: (m: any) => unknown) =>
      cb({ getRepository: (E: any) => (E === PoolTournament ? tRepoTx : {}) }),
  } as unknown as DataSource;

  const poolService = { assertModePlayable: jest.fn(), getConfig: jest.fn() } as unknown as PoolService;
  const walletService = {
    ensureDefaultWallet: jest.fn().mockResolvedValue({}),
    creditInSession: jest.fn().mockResolvedValue({}),
  } as unknown as WalletService;
  const rngService = { drawUniqueNumbers: jest.fn() } as unknown as RngService;
  const matchService = { createMatch: jest.fn().mockResolvedValue({ id: 'next' }) } as unknown as PoolMatchService;

  const service = new PoolTournamentService(
    tournamentRepo,
    playerRepo,
    matchRepo,
    dataSource,
    poolService,
    walletService,
    rngService,
    matchService,
  );
  return { service, walletService, matchService, tRepoTx, playerRepo };
}

const finalMatch: Partial<PoolMatch> = {
  id: 'mf',
  tournamentId: 't1',
  tournamentRound: 0,
  tournamentSlot: 0,
  winnerSeat: 'A',
  seatAUserId: 'champ',
  seatBUserId: 'runner',
};

describe('PoolTournamentService.onMatchCompleted', () => {
  it('pays the prize (pool minus rake) when the final ends', async () => {
    // rounds = 1 → round 0 is the final.
    const { service, walletService, tRepoTx } = harness({
      tournament: { id: 't1', status: 'active', rounds: 1, prizePoolMinor: 200, rakePct: 10 },
    });
    await service.onMatchCompleted(finalMatch as PoolMatch);

    expect(walletService.creditInSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'champ',
        amountMinor: 180, // 200 - 10%
        entryType: 'win',
        idempotencyKey: 'pool-tourney-prize:t1',
      }),
      expect.anything(),
    );
    expect(tRepoTx.update).toHaveBeenCalledWith(
      { id: 't1', status: 'active' },
      expect.objectContaining({ status: 'completed', winnerUserId: 'champ' }),
    );
  });

  it('creates the next-round match once both feeders are done', async () => {
    // rounds = 2 → round 0 is a semi; sibling slot 1 already completed.
    const { service, matchService } = harness({
      tournament: { id: 't1', status: 'active', rounds: 2, prizePoolMinor: 400, rakePct: 10 },
      sibling: { tournamentSlot: 1, winnerSeat: 'B', seatAUserId: 'x', seatBUserId: 'u1', status: 'completed' } as Partial<PoolMatch>,
    });
    const semi: Partial<PoolMatch> = {
      id: 'ms', tournamentId: 't1', tournamentRound: 0, tournamentSlot: 0,
      winnerSeat: 'A', seatAUserId: 'u0', seatBUserId: 'y',
    };
    await service.onMatchCompleted(semi as PoolMatch);

    expect(matchService.createMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'tournament',
        tournamentId: 't1',
        tournamentRound: 1,
        tournamentSlot: 0,
        seatAUserId: 'u0', // winner of slot 0
        seatBUserId: 'u1', // winner of slot 1 (sibling)
      }),
    );
  });

  it('waits for the sibling before advancing', async () => {
    const { service, matchService } = harness({
      tournament: { id: 't1', status: 'active', rounds: 2, prizePoolMinor: 400, rakePct: 10 },
      sibling: null, // sibling not finished
    });
    const semi: Partial<PoolMatch> = {
      id: 'ms', tournamentId: 't1', tournamentRound: 0, tournamentSlot: 0,
      winnerSeat: 'A', seatAUserId: 'u0', seatBUserId: 'y',
    };
    await service.onMatchCompleted(semi as PoolMatch);
    expect(matchService.createMatch).not.toHaveBeenCalled();
  });
});
