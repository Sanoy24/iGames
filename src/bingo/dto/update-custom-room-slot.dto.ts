import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';
import { BINGO_CARD_PALETTE_IDS } from '../bingo-card-palette.util';
import { BingoPatternPrizeDto, BingoPrizeConfigDto } from './create-bingo-room.dto';

/**
 * Partial update to a persistent custom room slot. Non-retroactive fields
 * (name/palette/ball) push to the slot's currently-live room immediately, same
 * as UpdateRoomSlotDto for House/Agent slots; ticketPriceMinor only pushes live
 * if that room has sold zero tickets so far (see BingoService.updateCustomRoomSlot).
 */
export class UpdateCustomRoomSlotDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ticketPriceMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTickets?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BingoPrizeConfigDto)
  prizes?: BingoPrizeConfigDto;

  @IsOptional()
  @IsIn(['line', 'pattern', 'prefilled'])
  winMode?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  numberRange?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  gridSize?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BingoPatternPrizeDto)
  patternPrizes?: BingoPatternPrizeDto[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(BINGO_CARD_PALETTE_IDS)
  cardPaletteId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  cardBallNumber?: number | null;

  /** Pause (false) or resume (true) this slot's auto-recreation without losing its settings. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
