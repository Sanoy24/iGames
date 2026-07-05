import { ExecutionContext } from '@nestjs/common';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

type MockRequest = { header: (name: string) => string | undefined; user?: unknown };

function makeContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeRequest(authHeader?: string): MockRequest {
  return {
    header: (name: string) => (name.toLowerCase() === 'authorization' ? authHeader : undefined),
  };
}

describe('OptionalJwtAuthGuard', () => {
  const configService = { getOrThrow: () => 'test-secret' } as any;
  const reflector = { getAllAndOverride: () => undefined } as any; // route not @Public

  function buildGuard(opts: {
    verify?: () => Promise<unknown>;
    userStatus?: string | null;
  }) {
    const jwtService = {
      verifyAsync: opts.verify ?? jest.fn().mockRejectedValue(new Error('no token')),
    } as any;
    const dataSource = {
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue(opts.userStatus === null ? null : { status: opts.userStatus ?? 'active' }),
      }),
    } as any;
    return new OptionalJwtAuthGuard(configService, jwtService, dataSource, reflector);
  }

  it('allows an anonymous request (no token) and leaves request.user unset', async () => {
    const guard = buildGuard({});
    const request = makeRequest(undefined);

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('populates request.user for a valid token from an active account', async () => {
    const guard = buildGuard({
      verify: jest.fn().mockResolvedValue({ sub: 'user-1', roles: ['player'], sessionId: 'sess-1' }),
      userStatus: 'active',
    });
    const request = makeRequest('Bearer good.token.here');

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', roles: ['player'], sessionId: 'sess-1' });
  });

  it('falls back to anonymous on an invalid/expired token (never rejects)', async () => {
    const guard = buildGuard({ verify: jest.fn().mockRejectedValue(new Error('jwt expired')) });
    const request = makeRequest('Bearer bad.token');

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('falls back to anonymous when the account is not active', async () => {
    const guard = buildGuard({
      verify: jest.fn().mockResolvedValue({ sub: 'user-2', roles: ['player'] }),
      userStatus: 'suspended',
    });
    const request = makeRequest('Bearer good.token');

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });
});
