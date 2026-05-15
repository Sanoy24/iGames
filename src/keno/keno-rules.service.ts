import { BadRequestException, Injectable } from '@nestjs/common';
import { KenoConfigDocument } from './schemas/keno-config.schema';

@Injectable()
export class KenoRulesService {
  validateSelectedNumbers(selectedNumbers: number[], config: KenoConfigDocument): void {
    const spotCount = selectedNumbers.length;
    if (!config.allowedSpots.includes(spotCount)) {
      throw new BadRequestException('Selected spot count is not allowed');
    }

    const uniqueNumbers = new Set(selectedNumbers);
    if (uniqueNumbers.size !== selectedNumbers.length) {
      throw new BadRequestException('Keno selected numbers must be unique');
    }

    const outOfRange = selectedNumbers.some(
      (number) => number < config.numberMin || number > config.numberMax
    );
    if (outOfRange) {
      throw new BadRequestException('Keno selected numbers are out of range');
    }
  }

  countMatches(selectedNumbers: number[], drawnNumbers: number[]): number {
    const drawn = new Set(drawnNumbers);
    return selectedNumbers.filter((number) => drawn.has(number)).length;
  }

  calculatePayoutMinor(input: {
    stakeMinor: number;
    spotCount: number;
    matches: number;
    config: KenoConfigDocument;
  }): number {
    const entry = input.config.paytable.find(
      (paytableEntry) =>
        paytableEntry.spots === input.spotCount &&
        paytableEntry.matches === input.matches
    );

    if (!entry) {
      return 0;
    }

    return input.stakeMinor * entry.payoutMultiplier;
  }
}
