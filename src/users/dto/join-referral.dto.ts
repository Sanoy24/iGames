import { IsString, MaxLength, MinLength } from 'class-validator';

export class JoinReferralDto {
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    code: string;
}
