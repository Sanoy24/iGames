import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { PatternType } from '../entities/bingo-pattern.entity';

const PATTERN_TYPES: PatternType[] = [
  'fixed',
  'any_row',
  'any_col',
  'any_diagonal',
  'any_line',
  'any_two_lines',
  'any_three_lines',
  'coverall',
];

export class CreateBingoPatternDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(PATTERN_TYPES)
  patternType: PatternType;

  @IsOptional()
  @IsArray()
  mask?: boolean[][];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateBingoPatternDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PATTERN_TYPES)
  patternType?: PatternType;

  @IsOptional()
  @IsArray()
  mask?: boolean[][];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
