import { ArrayMinSize, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateBingoConfigDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsInt() @Min(0)
  autoRepeatIntervalMinutes?: number;

  @IsOptional() @IsInt() @Min(1)
  defaultTicketPriceMinor?: number;

  @IsOptional() @IsInt() @Min(1)
  defaultMaxTickets?: number;

  /** Max cartelas one user may buy per bingo room/game. 0 = unlimited. */
  @IsOptional() @IsInt() @Min(0)
  maxCartelasPerUser?: number;

  @IsOptional() @IsInt() @Min(0)
  defaultOneLineMinor?: number;

  @IsOptional() @IsInt() @Min(0)
  defaultTwoLinesMinor?: number;

  @IsOptional() @IsInt() @Min(0)
  defaultFullHouseMinor?: number;

  @IsOptional() @IsInt() @Min(1)
  drawIntervalSeconds?: number;

  @IsOptional() @IsInt() @Min(5)
  salesWindowSeconds?: number;

  @IsOptional() @IsInt() @Min(0)
  cartelaChangeLockSeconds?: number;

  @IsOptional() @IsInt() @Min(0)
  resultDisplaySeconds?: number;

  @IsOptional() @IsIn(['line', 'pattern', 'prefilled'])
  defaultWinMode?: string;

  @IsOptional() @IsInt() @Min(10)
  defaultNumberRange?: number;

  @IsOptional() @IsInt() @Min(10)
  defaultGridSize?: number;

  @IsOptional() @IsInt() @Min(0)
  minDrawsBeforeWin?: number;

  @IsOptional() @IsInt() @Min(0)
  minTicketsToStart?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  houseEdgePct?: number;

  @IsOptional() @IsInt() @Min(0)
  globalBingoBotWinInterval?: number;

  @IsOptional() @IsBoolean()
  botCartelaPolicyEnabled?: boolean;

  @IsOptional() @IsIn(['mirror', 'fixed_cap'])
  botCartelaPolicyMode?: 'mirror' | 'fixed_cap';

  @IsOptional() @IsInt() @Min(1)
  botMaxCartelasPerBotPerRoom?: number;

  /** Bots join when the real-player count falls below this threshold. */
  @IsOptional() @IsBoolean()
  botBelowThresholdEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0)
  botBelowThresholdRealPlayers?: number;

  /** Bots join when the real-player count rises above this threshold. */
  @IsOptional() @IsBoolean()
  botAboveThresholdEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0)
  botAboveThresholdRealPlayers?: number;

  /** Legacy below-threshold setting kept for compatibility. */
  @IsOptional() @IsInt() @Min(0)
  botMaxRealPlayers?: number;

  /** How bots steer a below-threshold room. */
  @IsOptional() @IsIn(['off', 'statistical', 'guaranteed', 'hybrid', 'cartel-dual', 'ranked-bot'])
  botWinMode?: string;

  @IsOptional() @IsBoolean()
  botBonusWinEnabled?: boolean;

  @IsOptional() @IsIn(['interval', 'random'])
  botBonusWinMode?: 'interval' | 'random';

  @IsOptional() @IsInt() @Min(0)
  botBonusWinEveryNRounds?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  botBonusWinChancePct?: number;

  /** Completed Bingo rooms a bot must sit out after winning. 0 = no cooldown. */
  @IsOptional() @IsInt() @Min(0)
  botWinnerCooldownRooms?: number;

  /** Master on/off for the Win Sequence (repeating Bot/User pattern), independent of botWinMode. */
  @IsOptional() @IsBoolean()
  winSequenceEnabled?: boolean;

  /** Exactly 4 slots, each 'bot' or 'user'. */
  @IsOptional() @IsArray() @ArrayMinSize(4) @ArrayMaxSize(4) @IsIn(['bot', 'user'], { each: true })
  winSequencePattern?: Array<'bot' | 'user'>;

  @IsOptional() @IsIn(['race', 'leaderboard'])
  prefilledRankingMode?: 'race' | 'leaderboard';

  @IsOptional() @IsInt() @Min(1) @Max(100)
  prefilledFirstPlacePct?: number;

  @IsOptional() @IsBoolean()
  prefilledSecondPlaceEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  prefilledSecondPlacePct?: number;

  @IsOptional() @IsBoolean()
  prefilledThirdPlaceEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  prefilledThirdPlacePct?: number;

  @IsOptional() @IsBoolean()
  prefilledFourthPlaceEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  prefilledFourthPlacePct?: number;

  @IsOptional() @IsBoolean()
  prefilledFifthPlaceEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  prefilledFifthPlacePct?: number;

  /** BingoPattern id that wins a place in prefilled/derash mode (null = Any Line). */
  @IsOptional() @IsString()
  prefilledWinPatternId?: string | null;

  /** Per-place winning patterns (null = fall back to prefilledWinPatternId → Any Line). */
  @IsOptional() @IsString()
  prefilledFirstPatternId?: string | null;

  @IsOptional() @IsString()
  prefilledSecondPatternId?: string | null;

  @IsOptional() @IsString()
  prefilledThirdPatternId?: string | null;

  @IsOptional() @IsString()
  prefilledFourthPatternId?: string | null;

  @IsOptional() @IsString()
  prefilledFifthPatternId?: string | null;

  /** JSON array of alias names for the reserved cartel (e.g. '["Abrsh","Yonas"]'). Null = use bot displayName. */
  @IsOptional() @IsString()
  botAliasPool?: string | null;
}
