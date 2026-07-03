import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Unable to process this withdrawal - invalid account details', description: 'Mandatory rejection reason (min 15 characters)' })
  @IsString()
  @MinLength(15, { message: 'Rejection remarks must be at least 15 characters' })
  remarks!: string;
}
