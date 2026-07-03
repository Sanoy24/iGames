import { BadRequestException, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { BingoGrid } from './entities/bingo-ticket.entity';
import { BingoPrizeTier } from './entities/bingo-room.entity';
import { BingoPattern, PatternType } from './entities/bingo-pattern.entity';

export type BingoTicketState = {
  markedNumbers: number[];
  completedLines: number[];
  achievedTiers: BingoPrizeTier[];
};

export type PatternTicketState = {
  markedNumbers: number[];
  completedPatternIds: string[];
};

// ─── Built-in pattern seed data ────────────────────────────────────────────────

export const BUILT_IN_PATTERNS: Array<{
  name: string;
  description: string;
  patternType: PatternType;
  mask?: boolean[][];
  sortOrder: number;
}> = [
  {
    name: 'Any Line',
    description: 'Complete any row, column, or diagonal',
    patternType: 'any_line',
    sortOrder: 0,
  },
  {
    name: 'Corners',
    description: 'Mark all 4 corner squares',
    patternType: 'fixed',
    mask: [
      [true,  false, false, false, true ],
      [false, false, false, false, false],
      [false, false, false, false, false],
      [false, false, false, false, false],
      [true,  false, false, false, true ],
    ],
    sortOrder: 1,
  },
  {
    name: 'Cross (+)',
    description: 'Complete center row and center column',
    patternType: 'fixed',
    mask: [
      [false, false, true, false, false],
      [false, false, true, false, false],
      [true,  true,  true, true,  true ],
      [false, false, true, false, false],
      [false, false, true, false, false],
    ],
    sortOrder: 2,
  },
  {
    name: 'X Pattern',
    description: 'Complete both diagonals',
    patternType: 'fixed',
    mask: [
      [true,  false, false, false, true ],
      [false, true,  false, true,  false],
      [false, false, true,  false, false],
      [false, true,  false, true,  false],
      [true,  false, false, false, true ],
    ],
    sortOrder: 3,
  },
  {
    name: 'T Shape',
    description: 'Top row and center column going down',
    patternType: 'fixed',
    mask: [
      [true, true, true, true, true],
      [false, false, true, false, false],
      [false, false, true, false, false],
      [false, false, true, false, false],
      [false, false, true, false, false],
    ],
    sortOrder: 4,
  },
  {
    name: 'L Shape',
    description: 'Left column and bottom row',
    patternType: 'fixed',
    mask: [
      [true, false, false, false, false],
      [true, false, false, false, false],
      [true, false, false, false, false],
      [true, false, false, false, false],
      [true, true,  true,  true,  true ],
    ],
    sortOrder: 5,
  },
  {
    name: 'Full House',
    description: 'Mark every number on the card',
    patternType: 'coverall',
    sortOrder: 6,
  },
];

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BingoRulesService {

  // ── 90-ball line-mode ticket ───────────────────────────────────────────────

  generateTicket(): BingoGrid {
    const mask = this.generateTicketMask();
    const grid: BingoGrid = Array.from({ length: 3 }, () => Array(9).fill(null));

    for (let column = 0; column < 9; column += 1) {
      const rows = mask
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row }) => row[column])
        .map(({ rowIndex }) => rowIndex);
      const numbers = this.drawColumnNumbers(column, rows.length);

      rows.forEach((rowIndex, index) => {
        grid[rowIndex][column] = numbers[index];
      });
    }

    this.assertValidTicket(grid);
    return grid;
  }

  assertValidTicket(grid: BingoGrid): void {
    if (grid.length !== 3 || grid.some((row) => row.length !== 9)) {
      throw new BadRequestException('90-ball Bingo ticket must be a 3x9 grid');
    }

    const numbers = grid.flat().filter((value): value is number => value !== null);
    if (numbers.length !== 15) {
      throw new BadRequestException('90-ball Bingo ticket must contain 15 numbers');
    }
    if (new Set(numbers).size !== numbers.length) {
      throw new BadRequestException('90-ball Bingo ticket numbers must be unique');
    }

    for (const row of grid) {
      const rowNumberCount = row.filter((value) => value !== null).length;
      if (rowNumberCount !== 5) {
        throw new BadRequestException('Every 90-ball Bingo ticket row must contain 5 numbers');
      }
    }

    for (let column = 0; column < 9; column += 1) {
      const columnNumbers = grid
        .map((row) => row[column])
        .filter((value): value is number => value !== null);
      if (columnNumbers.length < 1 || columnNumbers.length > 3) {
        throw new BadRequestException('Every 90-ball Bingo ticket column must contain 1 to 3 numbers');
      }
      if (!columnNumbers.every((number) => this.isInColumnRange(number, column))) {
        throw new BadRequestException('90-ball Bingo ticket column contains an out-of-range number');
      }
      const sorted = [...columnNumbers].sort((left, right) => left - right);
      if (columnNumbers.some((number, index) => number !== sorted[index])) {
        throw new BadRequestException('90-ball Bingo ticket column numbers must ascend top-down');
      }
    }
  }

  evaluateTicket(grid: BingoGrid, drawnNumbers: number[]): BingoTicketState {
    const drawn = new Set(drawnNumbers);
    const markedNumbers = grid
      .flat()
      .filter((value): value is number => value !== null && drawn.has(value))
      .sort((left, right) => left - right);
    const completedLines = grid
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter(({ row }) =>
        row
          .filter((value): value is number => value !== null)
          .every((number) => drawn.has(number))
      )
      .map(({ rowIndex }) => rowIndex);

    const achievedTiers: BingoPrizeTier[] = [];
    if (completedLines.length >= 1) achievedTiers.push('one_line');
    if (completedLines.length >= 2) achievedTiers.push('two_lines');
    if (completedLines.length === 3) achievedTiers.push('full_house');

    return { markedNumbers, completedLines, achievedTiers };
  }

  // ── 5×5 pattern-mode ticket ────────────────────────────────────────────────

  /**
   * Generate a 5×5 BINGO card.
   * Column ranges are evenly divided across the number pool.
   * Center cell [2][2] is the FREE space (null).
   */
  generatePatternCard(numberRange: number): (number | null)[][] {
    const ROWS = 5;
    const COLS = 5;
    const colWidth = Math.floor(numberRange / COLS);

    const grid: (number | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

    for (let col = 0; col < COLS; col++) {
      const min = col * colWidth + 1;
      const max = col === COLS - 1 ? numberRange : (col + 1) * colWidth;
      const isCenterCol = col === 2; // N column has FREE center
      const count = isCenterCol ? ROWS - 1 : ROWS;

      if (max - min + 1 < count) {
        throw new BadRequestException(
          `Column ${col}: range ${min}-${max} too narrow for ${count} unique numbers`,
        );
      }

      const numbers = this.pickUnique(min, max, count).sort((a, b) => a - b);
      let numIdx = 0;

      for (let row = 0; row < ROWS; row++) {
        if (isCenterCol && row === 2) {
          grid[row][col] = null; // FREE space
        } else {
          grid[row][col] = numbers[numIdx++];
        }
      }
    }

    return grid;
  }

  /**
   * Canonical, order-stable fingerprint of a 5×5 card, used to guarantee every
   * card in a room's pool is unique. Columns are already generated in ascending
   * order, so serialising column-major (FREE center as "F") yields the same
   * string for identical cards and different strings otherwise.
   */
  canonicalCardHash(grid: (number | null)[][]): string {
    const cols = grid[0]?.length ?? 0;
    const parts: string[] = [];
    for (let col = 0; col < cols; col++) {
      const colVals = grid.map((row) => (row[col] === null ? 'F' : String(row[col])));
      parts.push(colVals.join('-'));
    }
    return parts.join('|');
  }

  /**
   * Generate a pool of `count` unique 75-ball cards. Regenerates on collision
   * until `count` distinct cards exist (or a safety cap is hit). Returns cards
   * paired with their canonical hash; the caller assigns cartela numbers.
   */
  generateUniqueCardPool(
    count: number,
    numberRange: number,
  ): Array<{ grid: (number | null)[][]; hash: string }> {
    const seen = new Set<string>();
    const pool: Array<{ grid: (number | null)[][]; hash: string }> = [];
    // Generous cap: collisions are astronomically rare for 75-ball cards, but a
    // bound prevents an infinite loop if `count` ever exceeds the feasible space.
    const maxAttempts = count * 50 + 1000;
    let attempts = 0;
    while (pool.length < count && attempts < maxAttempts) {
      attempts += 1;
      const grid = this.generatePatternCard(numberRange);
      const hash = this.canonicalCardHash(grid);
      if (seen.has(hash)) continue;
      seen.add(hash);
      pool.push({ grid, hash });
    }
    if (pool.length < count) {
      throw new BadRequestException(
        `Unable to generate ${count} unique cards for a ${numberRange}-ball pool`,
      );
    }
    return pool;
  }

  /**
   * Build a 5×5 pattern card seeding it with player-chosen numbers.
   * Numbers not provided (or that fall outside a column's range) are auto-filled.
   * Center cell [2][2] is always FREE.
   */
  generatePatternCardFromSelection(selected: number[], numberRange: number): (number | null)[][] {
    const ROWS = 5;
    const COLS = 5;
    const colWidth = Math.floor(numberRange / COLS);

    // Bucket selected numbers by column
    const buckets: Set<number>[] = Array.from({ length: COLS }, () => new Set());
    for (const n of selected) {
      if (n < 1 || n > numberRange) continue;
      const col = Math.min(Math.floor((n - 1) / colWidth), COLS - 1);
      buckets[col].add(n);
    }

    const grid: (number | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

    for (let col = 0; col < COLS; col++) {
      const min = col * colWidth + 1;
      const max = col === COLS - 1 ? numberRange : (col + 1) * colWidth;
      const isFreeCol = col === 2;
      const needed = isFreeCol ? ROWS - 1 : ROWS;

      const picks = [...buckets[col]].slice(0, needed);
      const usedSet = new Set(picks);

      // Auto-fill remaining slots
      const pool = Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(
        (n) => !usedSet.has(n),
      );
      while (picks.length < needed && pool.length > 0) {
        const idx = randomInt(0, pool.length);
        picks.push(pool[idx]);
        pool.splice(idx, 1);
      }

      picks.sort((a, b) => a - b);

      let numIdx = 0;
      for (let row = 0; row < ROWS; row++) {
        if (isFreeCol && row === 2) {
          grid[row][col] = null; // FREE space
        } else {
          grid[row][col] = picks[numIdx++] ?? null;
        }
      }
    }

    return grid;
  }

  /**
   * Build a 90-ball ticket seeding it with up to 15 player-chosen numbers.
   * Numbers not provided are auto-filled. The final ticket satisfies all 90-ball
   * constraints (3×9, 5 per row, 1–3 per column, ascending within column).
   */
  generateTicketFromSelection(selected: number[]): BingoGrid {
    // Validate and deduplicate
    const valid = [...new Set(selected.filter((n) => n >= 1 && n <= 90))].slice(0, 15);

    // Group by column (0-based)
    const colBuckets: number[][] = Array.from({ length: 9 }, () => []);
    for (const n of valid) {
      let col: number;
      if (n <= 9) col = 0;
      else if (n === 90) col = 8;
      else col = Math.floor(n / 10);
      colBuckets[col].push(n);
    }

    // Truncate to at most 3 per column (90-ball constraint)
    for (let c = 0; c < 9; c++) {
      colBuckets[c] = colBuckets[c].slice(0, 3);
    }

    // Count how many numbers we have; auto-fill up to 15
    const totalSelected = colBuckets.reduce((s, b) => s + b.length, 0);
    const remaining = 15 - totalSelected;

    if (remaining > 0) {
      // Build pool of unused numbers
      const usedSet = new Set(colBuckets.flat());
      const pool: number[] = [];
      for (let n = 1; n <= 90; n++) {
        if (!usedSet.has(n)) pool.push(n);
      }
      // Shuffle and pick
      for (let i = pool.length - 1; i > 0; i--) {
        const j = randomInt(0, i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (let i = 0; i < remaining && i < pool.length; i++) {
        const n = pool[i];
        let col: number;
        if (n <= 9) col = 0;
        else if (n === 90) col = 8;
        else col = Math.floor(n / 10);
        if (colBuckets[col].length < 3) colBuckets[col].push(n);
        else {
          // Column full — find next available column
          for (let c = 0; c < 9; c++) {
            if (colBuckets[c].length < 3) { colBuckets[c].push(n); break; }
          }
        }
      }
    }

    // Sort each column ascending
    for (let c = 0; c < 9; c++) {
      colBuckets[c].sort((a, b) => a - b);
    }

    // Build grid using a mask that satisfies the row constraint (5 per row)
    return this.placeColumnsOnGrid(colBuckets);
  }

  private placeColumnsOnGrid(colBuckets: number[][]): BingoGrid {
    // Try to generate a valid mask up to 500 times, same as generateTicket
    for (let attempt = 0; attempt < 500; attempt++) {
      const mask = Array.from({ length: 3 }, () => Array(9).fill(false));

      for (let col = 0; col < 9; col++) {
        const count = colBuckets[col].length;
        if (count === 0) continue;
        const rows = this.pickUnique(0, 2, Math.min(count, 3));
        for (const row of rows) mask[row][col] = true;
      }

      // Ensure exactly 5 per row
      const rowCounts = mask.map((row) => row.filter(Boolean).length);
      if (rowCounts.every((c) => c === 5)) {
        const grid: BingoGrid = Array.from({ length: 3 }, () => Array(9).fill(null));
        const colIndices = Array(9).fill(0);
        for (let col = 0; col < 9; col++) {
          for (let row = 0; row < 3; row++) {
            if (mask[row][col]) {
              grid[row][col] = colBuckets[col][colIndices[col]++] ?? null;
            }
          }
        }
        return grid;
      }
    }

    // Fallback: generate a fresh random ticket
    return this.generateTicket();
  }

  /**
   * Evaluate which patterns are newly completed.
   * null cells in the grid are FREE spaces (always marked).
   */
  evaluatePatternTicket(
    grid: (number | null)[][],
    drawnNumbers: number[],
    patterns: BingoPattern[],
  ): PatternTicketState {
    const drawn = new Set(drawnNumbers);

    // Build marked matrix (null = FREE = always true)
    const marked: boolean[][] = grid.map((row) =>
      row.map((cell) => cell === null || drawn.has(cell)),
    );

    const markedNumbers = grid
      .flat()
      .filter((v): v is number => v !== null && drawn.has(v))
      .sort((a, b) => a - b);

    const completedPatternIds = patterns
      .filter((p) => this.isPatternCompleted(marked, p))
      .map((p) => p.id);

    return { markedNumbers, completedPatternIds };
  }

  // ── Shared prize splitting ─────────────────────────────────────────────────

  splitPrizeMinor(prizeMinor: number, winnerCount: number): number[] {
    if (winnerCount <= 0) return [];
    const baseShare = Math.floor(prizeMinor / winnerCount);
    const remainder = prizeMinor % winnerCount;
    return Array.from({ length: winnerCount }, (_, index) =>
      index < remainder ? baseShare + 1 : baseShare,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isPatternCompleted(marked: boolean[][], pattern: BingoPattern): boolean {
    const ROWS = marked.length;
    const COLS = marked[0]?.length ?? 0;

    switch (pattern.patternType as PatternType) {
      case 'any_line': {
        for (let r = 0; r < ROWS; r++) {
          if (marked[r].every((v) => v)) return true;
        }
        for (let c = 0; c < COLS; c++) {
          if (marked.every((row) => row[c])) return true;
        }
        if (ROWS === 5 && COLS === 5) {
          if ([0, 1, 2, 3, 4].every((i) => marked[i][i])) return true;
          if ([0, 1, 2, 3, 4].every((i) => marked[i][4 - i])) return true;
        }
        return false;
      }
      case 'any_row':
        return marked.some((row) => row.every((v) => v));

      case 'any_col':
        return Array.from({ length: COLS }, (_, c) =>
          marked.every((row) => row[c]),
        ).some(Boolean);

      case 'any_diagonal':
        if (ROWS !== 5 || COLS !== 5) return false;
        return (
          [0, 1, 2, 3, 4].every((i) => marked[i][i]) ||
          [0, 1, 2, 3, 4].every((i) => marked[i][4 - i])
        );

      case 'fixed':
        if (!pattern.mask) return false;
        return pattern.mask.every((maskRow, r) =>
          maskRow.every((required, c) => !required || (marked[r]?.[c] ?? false)),
        );

      case 'coverall':
        return marked.every((row) => row.every((v) => v));

      default:
        return false;
    }
  }

  private generateTicketMask(): boolean[][] {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const mask = Array.from({ length: 3 }, () => Array(9).fill(false));

      for (let row = 0; row < 3; row += 1) {
        const columns = this.pickUnique(0, 8, 5);
        for (const column of columns) {
          mask[row][column] = true;
        }
      }

      const columnCounts = Array.from({ length: 9 }, (_, column) =>
        mask.filter((row) => row[column]).length,
      );
      if (columnCounts.every((count) => count >= 1 && count <= 3)) {
        return mask;
      }
    }
    throw new Error('Unable to generate a valid 90-ball Bingo ticket mask');
  }

  private drawColumnNumbers(column: number, count: number): number[] {
    const [min, max] = this.getColumnRange(column);
    return this.pickUnique(min, max, count).sort((left, right) => left - right);
  }

  pickUnique(min: number, max: number, count: number): number[] {
    const pool = Array.from({ length: max - min + 1 }, (_, index) => min + index);

    for (let index = 0; index < count; index += 1) {
      const swapIndex = randomInt(index, pool.length);
      const selected = pool[swapIndex];
      pool[swapIndex] = pool[index];
      pool[index] = selected;
    }

    return pool.slice(0, count);
  }

  private isInColumnRange(number: number, column: number): boolean {
    const [min, max] = this.getColumnRange(column);
    return number >= min && number <= max;
  }

  private getColumnRange(column: number): [number, number] {
    if (column === 0) return [1, 9];
    if (column === 8) return [80, 90];
    return [column * 10, column * 10 + 9];
  }
}
