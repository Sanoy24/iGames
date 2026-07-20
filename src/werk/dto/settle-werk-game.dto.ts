import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Final standings the client reports when the game clock ends. The server treats
 * these as claims: it re-derives the prize from `rank` + `tieCount` against the
 * DB paytable (never trusting a client-sent prize) and clamps `rank`/`tieCount`
 * to the session's participant count. This is the known trust boundary of a
 * real-time skill-vs-bots game — money math stays server-authoritative and capped.
 */
export class SettleWerkGameDto {
  /** Human's final rank, 1 = best. */
  @IsInt()
  @Min(1)
  rank: number;

  /** How many finishers (incl. the human) share the human's rank. */
  @IsInt()
  @Min(1)
  tieCount: number;

  /** Total coin value the human collected (evidence). */
  @IsInt()
  @Min(0)
  coinValue: number;

  /** Mode B: the human failed to reach the center hub in time. */
  @IsOptional()
  @IsBoolean()
  eliminated?: boolean;
}
