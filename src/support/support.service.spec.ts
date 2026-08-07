import { BadRequestException } from '@nestjs/common';
import { SupportService } from './support.service';

// Covers only approveRefundRequest's Master Wallet wiring (BE-WALLET-01 follow-up:
// a refund is a discretionary credit with no external backing, same category as
// the admin "Adjust Wallet" flow)  the rest of SupportService is exercised at
// the integration level elsewhere.
function makeService(input: {
    message?: Partial<{
        id: string;
        requestType: string | null;
        requestStatus: string | null;
        requestedAmountMinor: number | null;
        ticketId: string;
        relatedType: string | null;
        relatedId: string | null;
    }>;
    ticket?: Partial<{ id: string; userId: string }>;
    creditFromMasterWallet?: jest.Mock;
}) {
    const message = {
        id: 'msg-1',
        requestType: 'refund',
        requestStatus: 'pending',
        requestedAmountMinor: 5000,
        ticketId: 'ticket-1',
        relatedType: null,
        relatedId: null,
        ...input.message,
    };
    const ticket = { id: 'ticket-1', userId: 'player-1', ...input.ticket };

    const messageRepo = {
        findOneBy: jest.fn().mockResolvedValue(message),
        save: jest.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
        create: jest.fn().mockImplementation((m: unknown) => m),
    };
    const ticketRepo = {
        findOneBy: jest.fn().mockResolvedValue(ticket),
        update: jest.fn().mockResolvedValue(undefined),
    };
    const adminService = {
        creditFromMasterWallet:
            input.creditFromMasterWallet ??
            jest.fn().mockResolvedValue({
                wallet: {},
                ledgerEntry: { id: 'ledger-1' },
            }),
    };
    const dataSource = {
        transaction: jest
            .fn()
            .mockImplementation((cb: (m: unknown) => Promise<unknown>) =>
                cb({}),
            ),
    };
    const notifications = {
        safeCreate: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = { emitSupportRequestUpdated: jest.fn() };

    const service = new SupportService(
        ticketRepo as any,
        messageRepo as any,
        {} as any, // withdrawalRepo
        {} as any, // depositRepo
        {} as any, // walletService
        adminService as any,
        dataSource as any,
        notifications as any,
        gateway as any,
    );

    return { service, messageRepo, ticketRepo, adminService, dataSource };
}

describe('SupportService  approveRefundRequest is Master-Wallet-backed', () => {
    it('credits the ticket owner from the Master Wallet, inside a transaction', async () => {
        const { service, adminService, dataSource } = makeService({});

        await service.approveRefundRequest('agent-1', 'msg-1', {
            amountMinor: 3000,
        } as any);

        expect(dataSource.transaction).toHaveBeenCalled();
        expect(adminService.creditFromMasterWallet).toHaveBeenCalledWith(
            expect.objectContaining({
                targetUserId: 'player-1',
                amountMinor: 3000,
                entryType: 'refund',
                sourceType: 'support_refund',
                sourceId: 'msg-1',
                idempotencyKey: 'support-refund:msg-1',
            }),
            expect.anything(),
        );
    });

    it('defaults the amount to the originally requested amount when none is specified', async () => {
        const { service, adminService } = makeService({});

        await service.approveRefundRequest('agent-1', 'msg-1', {} as any);

        expect(adminService.creditFromMasterWallet).toHaveBeenCalledWith(
            expect.objectContaining({ amountMinor: 5000 }),
            expect.anything(),
        );
    });

    it('rejects an amount exceeding the requested amount before ever touching the Master Wallet', async () => {
        const { service, adminService } = makeService({});

        await expect(
            service.approveRefundRequest('agent-1', 'msg-1', {
                amountMinor: 999999,
            } as any),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(adminService.creditFromMasterWallet).not.toHaveBeenCalled();
    });
});
