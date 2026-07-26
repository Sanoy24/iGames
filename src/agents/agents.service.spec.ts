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
}) {
  const usersService = {
    findOnDutyAgent: jest.fn().mockResolvedValue(input.onDutyAgent ?? null),
    findOnDutyAgents: jest.fn().mockResolvedValue(input.onDutyAgents ?? []),
  } as unknown as UsersService;

  const walletService = {
    getAvailableBalances: jest.fn().mockResolvedValue(input.balances ?? new Map()),
  } as unknown as WalletService;

  const service = new AgentsService(
    {} as any, // agentShiftRepository
    {} as any, // systemConfigRepository
    walletService,
    usersService,
    {} as any, // withdrawalProofVerifier
  );

  return { service, usersService, walletService };
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
});
