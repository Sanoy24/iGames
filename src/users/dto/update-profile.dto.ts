import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-]{7,20}$/, { message: 'phoneNumber must be a valid phone number' })
  phoneNumber?: string;
}
