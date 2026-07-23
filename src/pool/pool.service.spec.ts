import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PoolService } from './pool.service';
import { PoolConfig } from './entities/pool-config.entity';
import { GamesService } from '../games/games.service';

function makeConfig(overrides: Partial<PoolConfig> = {}): PoolConfig {
  return Object.assign(new PoolConfig(), {
    key: 'default',
    singlePlayerEnabled: true,
    singlePlayerStakeMinor: 0,
    botDifficulty: 'medium',
    twoPlayerEnabled: true,
    minStakeMinor: 10,
    maxStakeMinor: 1_000,
    rakePct: 5,
    shotClockSeconds: 30,
    tournamentEnabled: false,
    tournamentEntryFeeMinor: 50,
    tournamentSize: 8,
    tournamentRakePct: 10,
    rulesetVersion: 1,
    engineVersion: 1,
    updatedBy: null,
    ...overrides,
  });
}

function makeService(config: PoolConfig | null = makeConfig()) {
  let stored = config;
  const configRepo = {
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(stored)),
    create: jest.fn().mockImplementation((dto) => makeConfig(dto)),
    save: jest.fn().mockImplementation((c: PoolConfig) => {
      stored = c;
      return Promise.resolve(c);
    }),
  } as unknown as Repository<PoolConfig>;

  // ensureTable creates a query runner; stub it to report the table exists.
  const dataSource = {
    createQueryRunner: () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      hasTable: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    }),
    getMetadata: () => ({ tableName: 'pool_config' }),
    driver: {},
  } as unknown as DataSource;

  const gamesService = {
    assertPlayable: jest.fn().mockResolvedValue(undefined),
  } as unknown as GamesService;

  return { service: new PoolService(configRepo, dataSource, gamesService), configRepo, gamesService };
}

describe('PoolService', () => {
  it('seeds a default config row when none exists', async () => {
    const { service, configRepo } = makeService(null);
    const cfg = await service.getConfig();
    expect(cfg.key).toBe('default');
    expect(configRepo.save).toHaveBeenCalled();
  });

  it('rejects a config where min stake exceeds max stake', async () => {
    const { service } = makeService();
    await expect(
      service.updateConfig({ minStakeMinor: 2_000, maxStakeMinor: 1_000 }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-power-of-two tournament size', async () => {
    const { service } = makeService();
    await expect(service.updateConfig({ tournamentSize: 6 }, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a valid update and records the admin id', async () => {
    const { service } = makeService();
    const cfg = await service.updateConfig(
      { twoPlayerEnabled: false, rakePct: 8, tournamentSize: 16 },
      'admin-1',
    );
    expect(cfg.twoPlayerEnabled).toBe(false);
    expect(cfg.rakePct).toBe(8);
    expect(cfg.tournamentSize).toBe(16);
    expect(cfg.updatedBy).toBe('admin-1');
  });

  it('reports per-mode enablement from the config toggles', async () => {
    const { service } = makeService(makeConfig({ tournamentEnabled: true, singlePlayerEnabled: false }));
    expect(await service.isModeEnabled('single')).toBe(false);
    expect(await service.isModeEnabled('two_player')).toBe(true);
    expect(await service.isModeEnabled('tournament')).toBe(true);
  });

  it('assertModePlayable throws when the mode is disabled even if the game is playable', async () => {
    const { service, gamesService } = makeService(makeConfig({ twoPlayerEnabled: false }));
    await expect(service.assertModePlayable('two_player')).rejects.toBeInstanceOf(ForbiddenException);
    expect(gamesService.assertPlayable).toHaveBeenCalledWith('pool');
  });

  it('assertModePlayable passes when both the game and mode are available', async () => {
    const { service } = makeService();
    await expect(service.assertModePlayable('single')).resolves.toBeUndefined();
  });
});
