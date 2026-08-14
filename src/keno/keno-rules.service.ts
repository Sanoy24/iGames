import { BadRequestException, Injectable } from '@nestjs/common';
import { KenoConfig } from './entities/keno-config.entity';

@Injectable()
export class KenoRulesService {
  validateSelectedNumbers(selectedNumbers: number[], config: KenoConfig): void {
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

  validateStake(stakeMinor: number, config: KenoConfig): void {
    const min = config.minStakeMinor ?? 1;
    const max = config.maxStakeMinor ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isInteger(stakeMinor) || stakeMinor < min || stakeMinor > max) {
      throw new BadRequestException(`Keno stake must be between ${min} and ${max}`);
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
    config: KenoConfig;
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
