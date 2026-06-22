import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdminTopupDto {
  @IsInt()
  @Min(1)
  amountMinor: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AdminTransferToAgentDto {
  @IsString()
  agentId: string;

  @IsInt()
  @Min(1)
  amountMinor: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
