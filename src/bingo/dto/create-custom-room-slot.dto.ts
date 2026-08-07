import { Type } from 'class-transformer';
import {
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { BINGO_CARD_PALETTE_IDS } from '../bingo-card-palette.util';
import {
    BingoPatternPrizeDto,
    BingoPrizeConfigDto,
} from './create-bingo-room.dto';

/**
 * Creates a PERSISTENT custom room slot (see BingoService.ensureCustomRoomSlots):
 * an admin-defined room that keeps recreating itself with the same name/price/
 * prizes/style after every round, instead of the one-off room CreateBingoRoomDto
 * produces.
 */
export class CreateCustomRoomSlotDto {
    @IsString()
    name: string;

    @IsInt()
    @Min(1)
    ticketPriceMinor: number;

    @IsInt()
    @Min(1)
    maxTickets: number;

    @ValidateNested()
    @Type(() => BingoPrizeConfigDto)
    prizes: BingoPrizeConfigDto;

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

    /** Lobby card gradient  leave unset to assign one at random. */
    @IsOptional()
    @IsIn(BINGO_CARD_PALETTE_IDS)
    cardPaletteId?: string;

    /** Decorative ball number shown on the lobby card  leave unset for random. */
    @IsOptional()
    @IsInt()
    @Min(1)
    cardBallNumber?: number;
}
