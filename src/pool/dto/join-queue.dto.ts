import { IsInt, Min } from 'class-validator';

export class JoinQueueDto {
  /** Stake per player, in minor units. Must sit within the configured limits. */
  @IsInt()
  @Min(0)
  stakeMinor: number;
}
