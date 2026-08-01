import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSettlementDto {
  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
