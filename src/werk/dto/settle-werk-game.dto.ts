import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/**
 * The client's settlement claim. It reports only which coin INDICES the human
 * collected (indices into the server-reproduced layout) and, for Mode B, whether
 * it reached the centre. The server re-derives the coin value from its own
 * layout, runs the bots authoritatively, validates plausibility, and computes the
 * rank + prize — nothing here is trusted for money.
 */
export class SettleWerkGameDto {
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsInt({ each: true })
  @Min(0, { each: true })
  collectedCoinIndices: number[];

  /** Mode B: the human was inside the centre hub when time ran out. */
  @IsOptional()
  @IsBoolean()
  reachedCenter?: boolean;
}
