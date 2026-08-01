import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PaymentsService } from './payments.service';
import { User } from '../users/entities/user.entity';

// ─── Shared mock builder ──────────────────────────────────────────────────────

function makeManager(agent: { status: string } | null): EntityManager {
  return {
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === User) {
        return { findOneBy: jest.fn().mockResolvedValue(agent) };
      }
      return {};
    }),
  } as unknown as EntityManager;
}

function makeService({ agentDebitError }: { agentDebitError?: Error } = {}) {
  const mockWalletService = {
    fundUserCreditFromAgent: agentDebitError
      ? jest.fn().mockRejectedValue(agentDebitError)
      : jest.fn().mockResolvedValue({ wallet: {}, ledgerEntry: {}, idempotent: false }),
  } as any;
  const mockAdminService = {
    creditFromMasterWallet: jest.fn().mockResolvedValue({ wallet: {}, ledgerEntry: {}, idempotent: false }),
  } as any;

  const service = new PaymentsService(
    {} as any, // dataSource — not touched directly by fundDepositCredit
    {} as any, // telebirrDepositRepository
    {} as any, // mpesaDepositRepository
    {} as any, // telebirrReceiptVerifierService
    {} as any, // mpesaReceiptVerifierService
    mockWalletService,
    { safeCreate: jest.fn() } as any, // notificationsService
    mockAdminService,
  );

  return { service, mockWalletService, mockAdminService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
// `fundDepositCredit` is private — exercised directly (as PaymentsService's other
// helpers are, per this file's convention of unit-testing pure/isolated logic
// rather than the full submit* transaction flow) since it's the one piece of
// genuinely new money-routing logic in the deposit-crediting change.

describe('PaymentsService.fundDepositCredit — unit', () => {
  const baseInput = {
    userId: 'user-1',
    amountMinor: 1_000,
    sourceType: 'telebirr_receipt',
    sourceId: 'REC1',
    idempotencyKey: 'telebirr:REC1',
    metadata: {},
  };

  it('funds from the agent wallet when the agent is active and has sufficient balance', async () => {
    const { service, mockWalletService, mockAdminService } = makeService();
    const manager = makeManager({ status: 'active' });

    const result = await (service as any).fundDepositCredit(manager, { ...baseInput, agentId: 'agent-1' });

    expect(result.fundedBy).toBe('agent_wallet');
    expect(result.fundingFallbackReason).toBeUndefined();
    expect(mockWalletService.fundUserCreditFromAgent).toHaveBeenCalledTimes(1);
    expect(mockAdminService.creditFromMasterWallet).not.toHaveBeenCalled();
  });

  it('falls back to the Master Wallet when the agent wallet balance is insufficient', async () => {
    const { service, mockWalletService, mockAdminService } = makeService({
      agentDebitError: new ConflictException('Insufficient wallet balance or concurrent update failed'),
    });
    const manager = makeManager({ status: 'active' });

    const result = await (service as any).fundDepositCredit(manager, { ...baseInput, agentId: 'agent-1' });

    expect(result.fundedBy).toBe('master_wallet');
    expect(result.fundingFallbackReason).toBe('insufficient_agent_balance');
    expect(mockWalletService.fundUserCreditFromAgent).toHaveBeenCalledTimes(1);
    expect(mockAdminService.creditFromMasterWallet).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Master Wallet when the agent is suspended/closed, without attempting the agent debit', async () => {
    const { service, mockWalletService, mockAdminService } = makeService();
    const manager = makeManager({ status: 'suspended' });

    const result = await (service as any).fundDepositCredit(manager, { ...baseInput, agentId: 'agent-1' });

    expect(result.fundedBy).toBe('master_wallet');
    expect(result.fundingFallbackReason).toBe('agent_inactive');
    expect(mockWalletService.fundUserCreditFromAgent).not.toHaveBeenCalled();
    expect(mockAdminService.creditFromMasterWallet).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Master Wallet when no agent was matched at all', async () => {
    const { service, mockWalletService, mockAdminService } = makeService();
    const manager = makeManager(null);

    const result = await (service as any).fundDepositCredit(manager, { ...baseInput, agentId: undefined });

    expect(result.fundedBy).toBe('master_wallet');
    expect(result.fundingFallbackReason).toBe('no_agent_matched');
    expect(mockWalletService.fundUserCreditFromAgent).not.toHaveBeenCalled();
    expect(mockAdminService.creditFromMasterWallet).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-balance errors from the agent debit instead of silently falling back', async () => {
    const { service, mockAdminService } = makeService({ agentDebitError: new Error('unexpected boom') });
    const manager = makeManager({ status: 'active' });

    await expect(
      (service as any).fundDepositCredit(manager, { ...baseInput, agentId: 'agent-1' }),
    ).rejects.toThrow('unexpected boom');
    expect(mockAdminService.creditFromMasterWallet).not.toHaveBeenCalled();
  });
});
