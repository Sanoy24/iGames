import { ForbiddenException } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';

function makeAgent(overrides: Partial<{ id: string; displayName: string; phoneNumber: string; agentPermissions: { deposit: boolean; withdraw: boolean } }>) {
  return {
    id: 'agent-1',
    displayName: 'Agent One',
    phoneNumber: '0912345678',
    agentPermissions: undefined,
    ...overrides,
  } as any;
}

function makeService(input: {
  onDutyAgent?: ReturnType<typeof makeAgent> | null;
  onDutyAgents?: Array<ReturnType<typeof makeAgent>>;
  balances?: Map<string, number>;
  listPlayersResult?: any;
  findByIdResult?: any;
  queryRows?: unknown[][];
  referralCode?: string;
  referredPlayers?: number;
  botUsername?: string;
  withdrawalFeeRanges?: Array<{ minAmountMinor: number; maxAmountMinor: number | null; feeMinor: number }>;
  claimedWithdrawal?: any;
  verifiedPayout?: any;
  recordAgentWithdrawalProofResult?: any;
}) {
  const usersService = {
    findOnDutyAgent: jest.fn().mockResolvedValue(input.onDutyAgent ?? null),
    findOnDutyAgents: jest.fn().mockResolvedValue(input.onDutyAgents ?? []),
    listPlayersByAssignedAgentId: jest.fn().mockResolvedValue(
      input.listPlayersResult ?? { data: [], total: 0, page: 1, limit: 20, totalPages: 0 },
    ),
    findById: jest.fn().mockResolvedValue(input.findByIdResult ?? makeAgent({})),
    ensureAgentReferralCode: jest.fn().mockResolvedValue(input.referralCode ?? 'ABC234'),
    countReferredPlayers: jest.fn().mockResolvedValue(input.referredPlayers ?? 0),
  } as unknown as UsersService;

  const walletService = {
    getAvailableBalances: jest.fn().mockResolvedValue(input.balances ?? new Map()),
    getClaimedWithdrawalForAgent: jest.fn().mockResolvedValue(input.claimedWithdrawal),
    recordAgentWithdrawalProof: jest.fn().mockResolvedValue(input.recordAgentWithdrawalProofResult),
  } as unknown as WalletService;

  // getAreaPlayerActivity fires 6 parallel queries (telebirr, mpesa, withdrawals,
  // bingo, keno, crash) via systemConfigRepository.query — feed them in order.
  let callIndex = 0;
  const systemConfigRepository = {
    query: jest.fn().mockImplementation(() => {
      const rows = input.queryRows?.[callIndex] ?? [];
      callIndex++;
      return Promise.resolve(rows);
    }),
    findOneBy: jest.fn().mockResolvedValue({ telebirrCreditMinorPerBirr: 1 }),
  };

  const withdrawalFeeRangeRepository = {
    find: jest.fn().mockResolvedValue(input.withdrawalFeeRanges ?? []),
  };

  const withdrawalProofVerifier = {
    verifyPayout: jest.fn().mockResolvedValue(
      input.verifiedPayout ?? { reference: 'ref-1', provider: 'telebirr', verification: {} },
    ),
  };

  const configService = {
    get: jest.fn().mockImplementation((key: string, fallback?: string) =>
      key === 'TELEGRAM_BOT_USERNAME' ? (input.botUsername ?? '') : (fallback ?? ''),
    ),
  };

  const service = new AgentsService(
    {} as any, // agentShiftRepository
    systemConfigRepository as any,
    withdrawalFeeRangeRepository as any,
    walletService,
    usersService,
    withdrawalProofVerifier as any,
    configService as any,
  );

  return { service, usersService, walletService, systemConfigRepository, withdrawalFeeRangeRepository, withdrawalProofVerifier, configService };
}

describe('AgentsService — deposit-agent listing excludes zero-balance agents', () => {
  describe('getActiveAgentDepositInfo', () => {
    it('returns null when no agent is on duty', async () => {
      const { service } = makeService({ onDutyAgent: null });
      expect(await service.getActiveAgentDepositInfo()).toBeNull();
    });

    it('returns null when the on-duty agent lacks deposit permission', async () => {
      const agent = makeAgent({ agentPermissions: { deposit: false, withdraw: true } });
      const { service } = makeService({ onDutyAgent: agent, balances: new Map([['agent-1', 1000]]) });
      expect(await service.getActiveAgentDepositInfo()).toBeNull();
    });

    it('returns null when the agent wallet balance is exactly zero', async () => {
      const agent = makeAgent({});
      const { service } = makeService({ onDutyAgent: agent, balances: new Map([['agent-1', 0]]) });
      expect(await service.getActiveAgentDepositInfo()).toBeNull();
    });

    it('returns null when the agent has no wallet row at all (absent from the balance map)', async () => {
      const agent = makeAgent({});
      const { service } = makeService({ onDutyAgent: agent, balances: new Map() });
      expect(await service.getActiveAgentDepositInfo()).toBeNull();
    });

    it('returns the agent when funded (balance > 0)', async () => {
      const agent = makeAgent({});
      const { service } = makeService({ onDutyAgent: agent, balances: new Map([['agent-1', 500]]) });
      const result = await service.getActiveAgentDepositInfo();
      expect(result).toEqual({ displayName: 'Agent One', phoneNumber: '0912345678' });
    });
  });

  describe('getActiveAgentsDepositInfo', () => {
    it('returns an empty list when nobody is on duty', async () => {
      const { service } = makeService({ onDutyAgents: [] });
      expect(await service.getActiveAgentsDepositInfo()).toEqual([]);
    });

    it('excludes zero-balance agents but keeps funded ones', async () => {
      const funded = makeAgent({ id: 'agent-funded', displayName: 'Funded Agent' });
      const zero = makeAgent({ id: 'agent-zero', displayName: 'Zero Agent' });
      const unfunded = makeAgent({ id: 'agent-unfunded', displayName: 'Unfunded Agent' }); // absent from balances
      const { service, walletService } = makeService({
        onDutyAgents: [funded, zero, unfunded],
        balances: new Map([['agent-funded', 1000], ['agent-zero', 0]]),
      });

      const result = await service.getActiveAgentsDepositInfo();

      expect(result).toEqual([{ id: 'agent-funded', displayName: 'Funded Agent', phoneNumber: '0912345678' }]);
      expect(walletService.getAvailableBalances).toHaveBeenCalledWith(['agent-funded', 'agent-zero', 'agent-unfunded']);
    });

    it('excludes agents without deposit permission before even checking balance', async () => {
      const noPermission = makeAgent({ id: 'agent-no-perm', agentPermissions: { deposit: false, withdraw: true } });
      const { service, walletService } = makeService({ onDutyAgents: [noPermission] });

      const result = await service.getActiveAgentsDepositInfo();

      expect(result).toEqual([]);
      expect(walletService.getAvailableBalances).not.toHaveBeenCalled();
    });
  });

  // ── Area reporting (players directly assigned to this agent) ─────
  describe('listAreaPlayers', () => {
    it('enriches each player with isMyReferral', async () => {
      const { service } = makeService({
        listPlayersResult: {
          data: [
            {
              id: 'player-mine',
              displayName: 'My Referral',
              phoneNumber: '0911111111',
              assignedAgentId: 'agent-1',
              status: 'active',
              referredByAgentId: 'agent-1',
              createdAt: new Date('2026-01-01'),
              wallets: [{ currencyCode: 'CREDIT', availableMinor: 5000 }],
            },
            {
              id: 'player-other',
              displayName: 'Area Player',
              phoneNumber: '0922222222',
              assignedAgentId: 'agent-1',
              status: 'active',
              referredByAgentId: 'some-other-agent',
              createdAt: new Date('2026-01-02'),
              wallets: [],
            },
          ],
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      });

      const result = await service.listAreaPlayers('agent-1');

      expect(result.data).toEqual([
        expect.objectContaining({ id: 'player-mine', isMyReferral: true, walletBalanceMinor: 5000 }),
        expect.objectContaining({ id: 'player-other', isMyReferral: false, walletBalanceMinor: 0 }),
      ]);
    });

    it('passes the agent id and opts through to the player query', async () => {
      const { service, usersService } = makeService({});
      await service.listAreaPlayers('agent-1', { search: 'abebe', page: 2, limit: 10 });
      expect(usersService.listPlayersByAssignedAgentId).toHaveBeenCalledWith('agent-1', { search: 'abebe', page: 2, limit: 10 });
    });
  });

  describe('getAreaPlayerActivity', () => {
    it('403s when the player is assigned to a DIFFERENT agent', async () => {
      const { service } = makeService({
        findByIdResult: { id: 'player-1', assignedAgentId: 'other-agent', displayName: 'X', referredByAgentId: null },
      });

      await expect(service.getAreaPlayerActivity('agent-1', 'player-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403s when the player is not assigned to any agent', async () => {
      const { service } = makeService({
        findByIdResult: { id: 'player-1', assignedAgentId: null, displayName: 'X', referredByAgentId: null },
      });

      await expect(service.getAreaPlayerActivity('agent-1', 'player-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns deposits/withdrawals/games for a player assigned to this agent', async () => {
      const { service } = makeService({
        findByIdResult: {
          id: 'player-1',
          assignedAgentId: 'agent-1',
          displayName: 'Area Player',
          phoneNumber: '0911111111',
          referredByAgentId: 'agent-1',
        },
        queryRows: [
          [{ id: 'dep-1', receiptNo: 'ABC', amountMinor: 1000, status: 'credited', createdAt: new Date() }], // telebirr
          [], // mpesa
          [{ id: 'wd-1', amountMinor: 500, status: 'completed' }], // withdrawals
          [{ played: 5, won: 2, staked: 500, payout: 800 }], // bingo
          [{ played: 3, won: 0, staked: 300, payout: 0 }], // keno
          [{ played: 1, won: 1, staked: 100, payout: 250 }], // crash
        ],
      });

      const result = await service.getAreaPlayerActivity('agent-1', 'player-1');

      expect(result.player).toEqual({
        id: 'player-1', displayName: 'Area Player', phoneNumber: '0911111111', isMyReferral: true,
      });
      expect(result.deposits.telebirr).toHaveLength(1);
      expect(result.deposits.mpesa).toHaveLength(0);
      expect(result.withdrawals).toHaveLength(1);
      expect(result.games.bingo).toEqual({ played: 5, won: 2, stakedMinor: 500, payoutMinor: 800 });
      expect(result.games.keno).toEqual({ played: 3, won: 0, stakedMinor: 300, payoutMinor: 0 });
      expect(result.games.crash).toEqual({ played: 1, won: 1, stakedMinor: 100, payoutMinor: 250 });
    });
  });
});

describe('AgentsService — completeWithdrawal (flat withdrawal-fee ranges)', () => {
  const ranges = [
    { minAmountMinor: 1, maxAmountMinor: 50000, feeMinor: 1000 },
    { minAmountMinor: 50001, maxAmountMinor: null, feeMinor: 10000 },
  ];

  it('resolves the fee from the matching range and passes it through as a single flat feeMinor', async () => {
    const { service, walletService, withdrawalProofVerifier } = makeService({
      withdrawalFeeRanges: ranges,
      claimedWithdrawal: { amountMinor: 25000, destinationAccount: '0911111111' },
    });

    await service.completeWithdrawal('wd-1', 'agent-1', 'telebirr', 'proof-123', 'withdrawal-receipts/r1.jpg');

    // 25,000 falls in the first tier (fee 1,000) → the agent must have paid the
    // player 24,000, and recordAgentWithdrawalProof gets the resolved flat fee.
    // Money does NOT move here — that only happens on admin verification.
    expect(withdrawalProofVerifier.verifyPayout).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAmountMinor: 24000 }),
    );
    expect(walletService.recordAgentWithdrawalProof).toHaveBeenCalledWith(
      expect.objectContaining({
        withdrawalId: 'wd-1',
        agentId: 'agent-1',
        feeMinor: 1000,
        receiptFileUrl: 'withdrawal-receipts/r1.jpg',
      }),
    );
    // No more platform split — the old pct/superAdminUserId fields must be gone.
    const call = (walletService.recordAgentWithdrawalProof as jest.Mock).mock.calls[0][0];
    expect(call).not.toHaveProperty('serviceFeePct');
    expect(call).not.toHaveProperty('commissionPct');
    expect(call).not.toHaveProperty('superAdminUserId');
  });

  it('resolves the open-ended top tier for large amounts', async () => {
    const { service, walletService } = makeService({
      withdrawalFeeRanges: ranges,
      claimedWithdrawal: { amountMinor: 500000, destinationAccount: '0911111111' },
    });

    await service.completeWithdrawal('wd-2', 'agent-1', 'telebirr', 'proof-123', 'withdrawal-receipts/r2.jpg');

    expect(walletService.recordAgentWithdrawalProof).toHaveBeenCalledWith(
      expect.objectContaining({ feeMinor: 10000 }),
    );
  });

  it('rejects the withdrawal instead of silently charging zero when no active range covers the amount', async () => {
    const gappy = [{ minAmountMinor: 1, maxAmountMinor: 500, feeMinor: 10 }];
    const { service, walletService } = makeService({
      withdrawalFeeRanges: gappy,
      claimedWithdrawal: { amountMinor: 5000, destinationAccount: '0911111111' },
    });

    await expect(
      service.completeWithdrawal('wd-3', 'agent-1', 'telebirr', 'proof-123', 'withdrawal-receipts/r3.jpg'),
    ).rejects.toThrow(/fee configuration/i);
    expect(walletService.recordAgentWithdrawalProof).not.toHaveBeenCalled();
  });
});
