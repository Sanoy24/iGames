import { IsString, MinLength } from 'class-validator';

export class CompleteWithdrawalDto {
  @IsString()
  @MinLength(4)
  telebirrReference: string;
}
