import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Exactly one of `locationId` or `other: true` must be supplied  the service
 * rejects both-or-neither. Making "Other" explicit means a client that simply
 * forgets to send `locationId` gets an error instead of silently attributing
 * the player to the house.
 */
export class SetMyLocationDto {
    @IsOptional()
    @IsUUID('4')
    locationId?: string;

    @IsOptional()
    @IsBoolean()
    other?: boolean;
}
