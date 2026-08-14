import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PurchaseKenoTicketDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(80, { each: true })
  selectedNumbers: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  stakeMinor?: number;
}
