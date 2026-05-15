import { BadRequestException, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { BingoGrid } from './schemas/bingo-ticket.schema';
import { BingoPrizeTier } from './schemas/bingo-room.schema';

export type BingoTicketState = {
  markedNumbers: number[];
  completedLines: number[];
  achievedTiers: BingoPrizeTier[];
};

@Injectable()
export class BingoRulesService {
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
    if (completedLines.length >= 1) {
      achievedTiers.push('one_line');
    }
    if (completedLines.length >= 2) {
      achievedTiers.push('two_lines');
    }
    if (completedLines.length === 3) {
      achievedTiers.push('full_house');
    }

    return {
      markedNumbers,
      completedLines,
      achievedTiers
    };
  }

  splitPrizeMinor(prizeMinor: number, winnerCount: number): number[] {
    if (winnerCount <= 0) {
      return [];
    }
    const baseShare = Math.floor(prizeMinor / winnerCount);
    const remainder = prizeMinor % winnerCount;
    return Array.from({ length: winnerCount }, (_, index) =>
      index < remainder ? baseShare + 1 : baseShare
    );
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
        mask.filter((row) => row[column]).length
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

  private pickUnique(min: number, max: number, count: number): number[] {
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
    if (column === 0) {
      return [1, 9];
    }
    if (column === 8) {
      return [80, 90];
    }
    return [column * 10, column * 10 + 9];
  }
}
