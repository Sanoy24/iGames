import { IsBoolean } from 'class-validator';

export class SetBingoAutoDto {
  /** true = cards auto-win on the settlement tick; false = manual "Bingo" claim. */
  @IsBoolean()
  auto: boolean;
}
