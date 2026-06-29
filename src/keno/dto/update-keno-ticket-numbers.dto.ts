import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

export class UpdateKenoTicketNumbersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(80, { each: true })
  selectedNumbers: number[];
}
