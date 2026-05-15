import { BadRequestException } from '@nestjs/common';
import { BingoRulesService } from './bingo-rules.service';

describe('BingoRulesService', () => {
  const service = new BingoRulesService();

  // ─── generateTicket ───────────────────────────────────────────────────────
  describe('generateTicket', () => {
    it('generates a valid 3×9 ticket', () => {
      const grid = service.generateTicket();
      expect(grid.length).toBe(3);
      grid.forEach((row) => expect(row.length).toBe(9));
    });

    it('generates a ticket with exactly 15 numbers', () => {
      const grid = service.generateTicket();
      const numbers = grid.flat().filter((v) => v !== null);
      expect(numbers.length).toBe(15);
    });

    it('generates a ticket with exactly 5 numbers per row', () => {
      const grid = service.generateTicket();
      grid.forEach((row) => {
        const rowNums = row.filter((v) => v !== null);
        expect(rowNums.length).toBe(5);
      });
    });

    it('generates a ticket with all unique numbers', () => {
      const grid = service.generateTicket();
      const numbers = grid.flat().filter((v): v is number => v !== null);
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it('generates numbers within the correct column ranges', () => {
      const grid = service.generateTicket();
      for (let col = 0; col < 9; col++) {
        const colNums = grid.map((row) => row[col]).filter((v): v is number => v !== null);
        colNums.forEach((n) => {
          if (col === 0) {
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(9);
          } else if (col === 8) {
            expect(n).toBeGreaterThanOrEqual(80);
            expect(n).toBeLessThanOrEqual(90);
          } else {
            expect(n).toBeGreaterThanOrEqual(col * 10);
            expect(n).toBeLessThanOrEqual(col * 10 + 9);
          }
        });
      }
    });

    it('generates column numbers in ascending order top-down', () => {
      const grid = service.generateTicket();
      for (let col = 0; col < 9; col++) {
        const colNums = grid.map((row) => row[col]).filter((v): v is number => v !== null);
        for (let i = 1; i < colNums.length; i++) {
          expect(colNums[i]).toBeGreaterThan(colNums[i - 1]);
        }
      }
    });

    it('generates statistically distinct tickets', () => {
      const grids = Array.from({ length: 20 }, () =>
        service.generateTicket().flat().filter(Boolean).join(',')
      );
      const unique = new Set(grids);
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  // ─── assertValidTicket ────────────────────────────────────────────────────
  describe('assertValidTicket', () => {
    it('accepts a generated valid ticket', () => {
      const validGrid = service.generateTicket();
      expect(() => service.assertValidTicket(validGrid)).not.toThrow();
    });

    it('throws if grid is not 3 rows', () => {
      const badGrid = [[1, null, 21, null, 41, null, 61, null, 80]] as any;
      expect(() => service.assertValidTicket(badGrid)).toThrow(BadRequestException);
    });

    it('throws if a row does not have 9 columns', () => {
      const badGrid = service.generateTicket();
      (badGrid[0] as any) = badGrid[0].slice(0, 8);
      expect(() => service.assertValidTicket(badGrid)).toThrow(BadRequestException);
    });
  });

  // ─── evaluateTicket ───────────────────────────────────────────────────────
  describe('evaluateTicket', () => {
    // A fully known, valid grid for deterministic tests
    // row 0: 1, 22, 41, 61, 80
    // row 1: 10, 30, 55, 70, 81
    // row 2: 3, 15, 42, 62, 72
    const grid = [
      [1, null, 22, null, 41, null, 61, null, 80],
      [null, 10, null, 30, null, 55, null, 70, 81],
      [3, 15, null, null, 42, null, 62, 72, null]
    ];

    it('marks no numbers when nothing is drawn', () => {
      const state = service.evaluateTicket(grid, []);
      expect(state.markedNumbers).toEqual([]);
      expect(state.completedLines).toEqual([]);
      expect(state.achievedTiers).toEqual([]);
    });

    it('marks only numbers that have been drawn', () => {
      const state = service.evaluateTicket(grid, [1, 22, 99]);
      expect(state.markedNumbers).toEqual([1, 22]);
    });

    it('markedNumbers are sorted ascending', () => {
      const state = service.evaluateTicket(grid, [80, 1, 22]);
      expect(state.markedNumbers).toEqual([1, 22, 80]);
    });

    it('detects one_line when row 0 is complete', () => {
      const state = service.evaluateTicket(grid, [1, 22, 41, 61, 80]);
      expect(state.completedLines).toContain(0);
      expect(state.achievedTiers).toContain('one_line');
      expect(state.achievedTiers).not.toContain('two_lines');
      expect(state.achievedTiers).not.toContain('full_house');
    });

    it('detects two_lines when rows 0 and 1 are complete', () => {
      const state = service.evaluateTicket(grid, [1, 22, 41, 61, 80, 10, 30, 55, 70, 81]);
      expect(state.completedLines.sort()).toEqual([0, 1]);
      expect(state.achievedTiers).toContain('one_line');
      expect(state.achievedTiers).toContain('two_lines');
      expect(state.achievedTiers).not.toContain('full_house');
    });

    it('detects full_house when all three rows are complete', () => {
      const allNumbers = [1, 22, 41, 61, 80, 10, 30, 55, 70, 81, 3, 15, 42, 62, 72];
      const state = service.evaluateTicket(grid, allNumbers);
      expect(state.completedLines.sort()).toEqual([0, 1, 2]);
      expect(state.achievedTiers).toContain('one_line');
      expect(state.achievedTiers).toContain('two_lines');
      expect(state.achievedTiers).toContain('full_house');
    });
  });

  // ─── splitPrizeMinor ──────────────────────────────────────────────────────
  describe('splitPrizeMinor', () => {
    it('splits evenly when prize is divisible by winner count', () => {
      expect(service.splitPrizeMinor(15000, 3)).toEqual([5000, 5000, 5000]);
    });

    it('distributes remainder to early winners', () => {
      // 10000 ÷ 3 = 3333 rem 1 → [3334, 3333, 3333]
      const shares = service.splitPrizeMinor(10000, 3);
      expect(shares).toEqual([3334, 3333, 3333]);
    });

    it('total always equals the original prize (no rounding loss)', () => {
      const cases: [number, number][] = [[10001, 3], [99999, 7], [1, 5]];
      cases.forEach(([prize, winners]) => {
        const shares = service.splitPrizeMinor(prize, winners);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(prize);
      });
    });

    it('returns full prize for single winner', () => {
      expect(service.splitPrizeMinor(50000, 1)).toEqual([50000]);
    });

    it('returns empty array for 0 winners', () => {
      expect(service.splitPrizeMinor(50000, 0)).toEqual([]);
    });
  });
});
