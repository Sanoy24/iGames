import { IsInt, IsOptional, Min } from 'class-validator';

/** Start a new Werk Flega game. Stake is optional — omit to use the config default. */
export class StartWerkGameDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  stakeMinor?: number;
}
