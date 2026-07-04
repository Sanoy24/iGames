import { Repository } from 'typeorm';
import { TenantContextService } from './tenant-context.service';
import { TenantScopedRepository } from './tenant-scoped.repository';

/**
 * Proves the read-side isolation guarantee: every scoped query is constrained to
 * the current operator, and a query with no resolved tenant fails closed rather
 * than returning unscoped rows.
 */
describe('TenantScopedRepository', () => {
  let tenantContext: TenantContextService;
  let repo: jest.Mocked<Pick<Repository<any>, 'find' | 'findOne' | 'count' | 'createQueryBuilder'>>;
  let scoped: TenantScopedRepository<any>;

  beforeEach(() => {
    tenantContext = new TenantContextService();
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    } as any;
    scoped = new TenantScopedRepository(repo as unknown as Repository<any>, tenantContext);
  });

  it('injects the current operatorId into find() where clauses', async () => {
    await tenantContext.run(async () => {
      tenantContext.set('op-A', 'jwt');
      await scoped.find({ where: { status: 'open' } });
    });

    expect(repo.find).toHaveBeenCalledWith({ where: { status: 'open', operatorId: 'op-A' } });
  });

  it('scopes each clause of an array (OR) where', async () => {
    await tenantContext.run(async () => {
      tenantContext.set('op-A', 'jwt');
      await scoped.find({ where: [{ status: 'open' }, { status: 'running' }] });
    });

    expect(repo.find).toHaveBeenCalledWith({
      where: [
        { status: 'open', operatorId: 'op-A' },
        { status: 'running', operatorId: 'op-A' },
      ],
    });
  });

  it('cannot be tricked into reading another operator: two contexts stay separate', async () => {
    await tenantContext.run(async () => {
      tenantContext.set('op-A', 'jwt');
      await scoped.findOne({ where: { id: 'x' } });
    });
    await tenantContext.run(async () => {
      tenantContext.set('op-B', 'jwt');
      await scoped.findOne({ where: { id: 'x' } });
    });

    expect(repo.findOne).toHaveBeenNthCalledWith(1, { where: { id: 'x', operatorId: 'op-A' } });
    expect(repo.findOne).toHaveBeenNthCalledWith(2, { where: { id: 'x', operatorId: 'op-B' } });
  });

  it('fails closed when no tenant is resolved', async () => {
    await tenantContext.run(async () => {
      // no tenantContext.set(...)
      await expect(scoped.find({ where: { status: 'open' } })).rejects.toThrow(
        /no operator/i,
      );
    });
    expect(repo.find).not.toHaveBeenCalled();
  });
});
