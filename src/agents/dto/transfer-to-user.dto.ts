import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class TransferToUserDto {
  @IsString()
  @Matches(/^(\+?251|0)[79]\d{8}$/, { message: 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX or +2519XXXXXXXX)' })
  phoneNumber: string;

  @IsInt()
  @Min(1)
  amountMinor: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
