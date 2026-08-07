import {
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Min,
    ValidateIf,
} from 'class-validator';
import { BINGO_CARD_PALETTE_IDS } from '../bingo-card-palette.util';

/**
 * PERSISTENT room-slot settings (House or one agent)  applied the next time
 * BingoService.ensureAgentRooms recreates that slot's room. Pass a field as
 * null to clear it back to random/default.
 */
export class UpdateRoomSlotDto {
    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    label?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsIn(BINGO_CARD_PALETTE_IDS)
    cardPaletteId?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsInt()
    @Min(1)
    cardBallNumber?: number | null;

    /** Persistent ticket price for this slot. Null = fall back to the global default each recreation. */
    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsInt()
    @Min(1)
    ticketPriceMinor?: number | null;
}
