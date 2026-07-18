import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class ShotSpinDto {
  @IsNumber()
  @Min(-1)
  @Max(1)
  side: number;

  @IsNumber()
  @Min(-1)
  @Max(1)
  vertical: number;
}

export class CuePosDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}

export class SubmitShotDto {
  /** Aim direction, radians. */
  @IsNumber()
  angle: number;

  /** Cue power, 0–1. */
  @IsNumber()
  @Min(0)
  @Max(1)
  power: number;

  @ValidateNested()
  @Type(() => ShotSpinDto)
  spin: ShotSpinDto;

  /** Cue placement — only honoured when the shooter has ball in hand. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CuePosDto)
  cuePos?: CuePosDto;
}
