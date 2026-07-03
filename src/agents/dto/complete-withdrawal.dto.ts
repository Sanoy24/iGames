import { IsString, MinLength } from 'class-validator';

export class CompleteWithdrawalDto {
  @IsString()
  @MinLength(15)
  telebirrReference: string;
}
