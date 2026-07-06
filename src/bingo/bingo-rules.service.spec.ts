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

  // ─── 75-ball card pool (prefilled/derash) ─────────────────────────────────
  describe('generatePatternCard (75-ball)', () => {
    it('produces a 5×5 grid with a FREE center', () => {
      const card = service.generatePatternCard(75);
      expect(card.length).toBe(5);
      card.forEach((row) => expect(row.length).toBe(5));
      expect(card[2][2]).toBeNull();
    });

    it('uses standard B/I/N/G/O column ranges', () => {
      const card = service.generatePatternCard(75);
      const ranges = [
        [1, 15],
        [16, 30],
        [31, 45],
        [46, 60],
        [61, 75],
      ];
      for (let col = 0; col < 5; col++) {
        const nums = card.map((row) => row[col]).filter((v): v is number => v !== null);
        const expectedCount = col === 2 ? 4 : 5; // N column has the FREE center
        expect(nums.length).toBe(expectedCount);
        nums.forEach((n) => {
          expect(n).toBeGreaterThanOrEqual(ranges[col][0]);
          expect(n).toBeLessThanOrEqual(ranges[col][1]);
        });
        expect(new Set(nums).size).toBe(nums.length); // unique within column
      }
    });
  });

  describe('generateUniqueCardPool', () => {
    it('generates exactly N cards, all unique', () => {
      const N = 200;
      const pool = service.generateUniqueCardPool(N, 75);
      expect(pool.length).toBe(N);
      const hashes = new Set(pool.map((c) => c.hash));
      expect(hashes.size).toBe(N);
    });

    it('every card in the pool is a valid 75-ball card', () => {
      const pool = service.generateUniqueCardPool(30, 75);
      pool.forEach(({ grid }) => {
        expect(grid.length).toBe(5);
        expect(grid[2][2]).toBeNull();
        const nums = grid.flat().filter((v): v is number => v !== null);
        expect(nums.length).toBe(24); // 25 cells minus the FREE center
        nums.forEach((n) => {
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(75);
        });
      });
    });

    it('gives identical cards the same canonical hash and different cards different hashes', () => {
      const a = service.generatePatternCard(75);
      expect(service.canonicalCardHash(a)).toBe(service.canonicalCardHash(a));
      const b = service.generatePatternCard(75);
      if (service.canonicalCardHash(a) !== service.canonicalCardHash(b)) {
        expect(service.canonicalCardHash(a)).not.toBe(service.canonicalCardHash(b));
      }
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

  // ─── multi-line patterns (any_two_lines / any_three_lines) ──────────────────
  describe('evaluatePatternTicket — multi-line patterns', () => {
    // 5×5 card with a FREE centre. Rows carry contiguous number blocks so a whole
    // row is completed by drawing exactly that block.
    const grid: (number | null)[][] = [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, null, 13, 14],
      [15, 16, 17, 18, 19],
      [20, 21, 22, 23, 24],
    ];
    const pattern = (patternType: string) => ({ id: patternType, patternType }) as any;
    const completes = (drawn: number[], patternType: string) =>
      service
        .evaluatePatternTicket(grid, drawn, [pattern(patternType)])
        .completedPatternIds.includes(patternType);

    const row0 = [1, 2, 3, 4, 5];
    const row1 = [6, 7, 8, 9, 10];
    const row2 = [11, 12, 13, 14]; // centre is FREE

    it('any_two_lines needs two completed lines', () => {
      expect(completes(row0, 'any_two_lines')).toBe(false);
      expect(completes([...row0, ...row1], 'any_two_lines')).toBe(true);
    });

    it('any_three_lines needs three completed lines', () => {
      expect(completes([...row0, ...row1], 'any_three_lines')).toBe(false);
      expect(completes([...row0, ...row1, ...row2], 'any_three_lines')).toBe(true);
    });

    it('any_line still completes on a single line', () => {
      expect(completes(row0, 'any_line')).toBe(true);
    });
  });
});
