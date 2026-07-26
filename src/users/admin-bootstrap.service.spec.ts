import { ConfigService } from '@nestjs/config';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { UsersService } from './users.service';

function makeService(configValue: string | undefined, ensureAdminAccount = jest.fn().mockResolvedValue('created')) {
  const configService = { get: jest.fn().mockReturnValue(configValue) } as unknown as ConfigService;
  const usersService = { ensureAdminAccount } as unknown as UsersService;
  return { service: new AdminBootstrapService(configService, usersService), ensureAdminAccount };
}

describe('AdminBootstrapService', () => {
  it('is a no-op when ADMIN_BOOTSTRAP_ACCOUNTS is unset', async () => {
    const { service, ensureAdminAccount } = makeService(undefined);
    await service.onApplicationBootstrap();
    expect(ensureAdminAccount).not.toHaveBeenCalled();
  });

  it('is a no-op when ADMIN_BOOTSTRAP_ACCOUNTS is blank', async () => {
    const { service, ensureAdminAccount } = makeService('   ');
    await service.onApplicationBootstrap();
    expect(ensureAdminAccount).not.toHaveBeenCalled();
  });

  it('creates every configured account', async () => {
    const accounts = [
      { phoneNumber: '+251936633529', password: 'yoni1234', displayName: 'Yoni' },
      { phoneNumber: '+251953434253', password: 'bini1234', displayName: 'Bini' },
    ];
    const { service, ensureAdminAccount } = makeService(JSON.stringify(accounts));
    await service.onApplicationBootstrap();
    expect(ensureAdminAccount).toHaveBeenCalledTimes(2);
    expect(ensureAdminAccount).toHaveBeenCalledWith({ phoneNumber: '+251936633529', password: 'yoni1234', displayName: 'Yoni' });
    expect(ensureAdminAccount).toHaveBeenCalledWith({ phoneNumber: '+251953434253', password: 'bini1234', displayName: 'Bini' });
  });

  it('defaults a missing displayName to "Admin"', async () => {
    const { service, ensureAdminAccount } = makeService(
      JSON.stringify([{ phoneNumber: '+251900000000', password: 'password123' }]),
    );
    await service.onApplicationBootstrap();
    expect(ensureAdminAccount).toHaveBeenCalledWith({ phoneNumber: '+251900000000', password: 'password123', displayName: 'Admin' });
  });

  it('skips the whole list when the JSON is malformed, without throwing', async () => {
    const { service, ensureAdminAccount } = makeService('not valid json{{{');
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(ensureAdminAccount).not.toHaveBeenCalled();
  });

  it('skips the whole list when the JSON is not an array', async () => {
    const { service, ensureAdminAccount } = makeService(JSON.stringify({ phoneNumber: '+251900000000', password: 'password123' }));
    await service.onApplicationBootstrap();
    expect(ensureAdminAccount).not.toHaveBeenCalled();
  });

  it('skips an individual entry missing phoneNumber or password, but still processes the rest', async () => {
    const accounts = [
      { phoneNumber: '', password: 'password123' },
      { phoneNumber: '+251900000000', password: '' },
      { phoneNumber: '+251911111111', password: 'password123' },
    ];
    const { service, ensureAdminAccount } = makeService(JSON.stringify(accounts));
    await service.onApplicationBootstrap();
    expect(ensureAdminAccount).toHaveBeenCalledTimes(1);
    expect(ensureAdminAccount).toHaveBeenCalledWith({ phoneNumber: '+251911111111', password: 'password123', displayName: 'Admin' });
  });

  it('skips an entry whose password is shorter than 8 characters', async () => {
    const { service, ensureAdminAccount } = makeService(
      JSON.stringify([{ phoneNumber: '+251900000000', password: 'short' }]),
    );
    await service.onApplicationBootstrap();
    expect(ensureAdminAccount).not.toHaveBeenCalled();
  });

  it('continues to the next account when one fails', async () => {
    const ensureAdminAccount = jest
      .fn()
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce('created');
    const accounts = [
      { phoneNumber: '+251900000000', password: 'password123' },
      { phoneNumber: '+251911111111', password: 'password123' },
    ];
    const { service } = makeService(JSON.stringify(accounts), ensureAdminAccount);
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(ensureAdminAccount).toHaveBeenCalledTimes(2);
  });
});
