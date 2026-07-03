import { BadRequestException } from '@nestjs/common';
import { KenoRulesService } from './keno-rules.service';
import { KenoConfig } from './entities/keno-config.entity';
import { DEFAULT_KENO_PAYTABLE } from './constants/default-keno-paytable';

describe('KenoRulesService', () => {
  const service = new KenoRulesService();

  const config = {
    id: 'test-config-uuid',
    name: 'Test Config',
    version: 1,
    status: 'active',
    allowedSpots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    numberMin: 1,
    numberMax: 80,
    drawSize: 20,
    ticketPriceMinor: 100,
    paytable: DEFAULT_KENO_PAYTABLE,
    globalBotWinInterval: 0,
    autoScheduleIntervalMinutes: 3,
    autoScheduleIntervalSeconds: 40,
    maxWinnersPerDraw: 0,
    winChancePct: 100,
    createdAt: new Date(),
    updatedAt: new Date()
  } as KenoConfig;

  // ─── validateSelectedNumbers ──────────────────────────────────────────────
  describe('validateSelectedNumbers', () => {
    it('accepts valid unique selected numbers', () => {
      expect(() => service.validateSelectedNumbers([1, 2, 3], config)).not.toThrow();
    });

    it('accepts boundary values (1 and 80)', () => {
      expect(() => service.validateSelectedNumbers([1, 80, 40], config)).not.toThrow();
    });

    it('rejects duplicate selected numbers', () => {
      expect(() => service.validateSelectedNumbers([1, 1, 2], config)).toThrow(BadRequestException);
    });

    it('rejects out-of-range selected numbers (above max)', () => {
      expect(() => service.validateSelectedNumbers([1, 2, 81], config)).toThrow(BadRequestException);
    });

    it('rejects out-of-range selected numbers (below min = 0)', () => {
      expect(() => service.validateSelectedNumbers([0, 1, 2], config)).toThrow(BadRequestException);
    });

    it('rejects spot count not in allowedSpots', () => {
      const restrictedConfig = { ...config, allowedSpots: [1, 2, 3] } as KenoConfig;
      expect(() =>
        service.validateSelectedNumbers([1, 2, 3, 4], restrictedConfig)
      ).toThrow(BadRequestException);
    });
  });

  // ─── countMatches ─────────────────────────────────────────────────────────
  describe('countMatches', () => {
    it('returns 0 when no numbers match', () => {
      expect(service.countMatches([1, 2, 3], [4, 5, 6])).toBe(0);
    });

    it('counts partial matches correctly', () => {
      expect(service.countMatches([1, 2, 3], [3, 4, 5, 1])).toBe(2);
    });

    it('returns full match when all selected numbers are drawn', () => {
      expect(service.countMatches([10, 20, 30], [10, 20, 30, 40, 50])).toBe(3);
    });

    it('returns correct match with 5-spot selection', () => {
      expect(service.countMatches([3, 15, 27, 44, 68], [3, 15, 27, 44, 99])).toBe(4);
    });
  });

  // ─── calculatePayoutMinor ─────────────────────────────────────────────────
  describe('calculatePayoutMinor', () => {
    it('calculates payout for 1 spot, 1 match (3× multiplier)', () => {
      expect(
        service.calculatePayoutMinor({ stakeMinor: 100, spotCount: 1, matches: 1, config })
      ).toBe(300);
    });

    it('returns 0 for a loss (5 spots, 2 matches — no paytable entry)', () => {
      expect(
        service.calculatePayoutMinor({ stakeMinor: 100, spotCount: 5, matches: 2, config })
      ).toBe(0);
    });

    it('returns break-even payout for 4 spots, 2 matches (1× multiplier)', () => {
      expect(
        service.calculatePayoutMinor({ stakeMinor: 500, spotCount: 4, matches: 2, config })
      ).toBe(500);
    });

    it('calculates top prize for 5 spots, 5 matches (800× multiplier)', () => {
      expect(
        service.calculatePayoutMinor({ stakeMinor: 100, spotCount: 5, matches: 5, config })
      ).toBe(80_000);
    });

    it('calculates top prize for 12 spots, 12 matches (100000× multiplier)', () => {
      expect(
        service.calculatePayoutMinor({ stakeMinor: 100, spotCount: 12, matches: 12, config })
      ).toBe(10_000_000);
    });

    it('returns 0 when matches is 0', () => {
      expect(
        service.calculatePayoutMinor({ stakeMinor: 100, spotCount: 5, matches: 0, config })
      ).toBe(0);
    });
  });

  // ─── full paytable integrity check ────────────────────────────────────────
  describe('paytable integrity — every defined entry is computed correctly', () => {
    it.each(DEFAULT_KENO_PAYTABLE)(
      'spots=$spots matches=$matches → stake × $payoutMultiplier',
      ({ spots, matches, payoutMultiplier }) => {
        const payout = service.calculatePayoutMinor({
          stakeMinor: 100,
          spotCount: spots,
          matches,
          config
        });
        expect(payout).toBe(100 * payoutMultiplier);
      }
    );
  });
});
