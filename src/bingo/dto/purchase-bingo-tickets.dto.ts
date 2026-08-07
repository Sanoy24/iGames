import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    IsOptional,
    Max,
    Min,
} from 'class-validator';

export class PurchaseBingoTicketsDto {
    /** Number of cards to buy (line/pattern mode). Defaults to 1. */
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(24)
    count?: number;

    /**
     * Cartela numbers to buy (prefilled/derash mode). Each maps to a fresh mapped
     * card. Players select several then pay once.
     */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(24)
    @IsInt({ each: true })
    @Min(1, { each: true })
    cartelaNumbers?: number[];

    /**
     * Optional player-chosen numbers for the first ticket (line/pattern mode).
     * Partial lists are accepted  the backend fills remaining spots randomly.
     */
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    selectedNumbers?: number[];
}
