import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CreateBotDto } from './create-bot.dto';

export class BulkCreateBotDto extends PartialType(
  OmitType(CreateBotDto, ['displayName'] as const),
) {
  @ApiProperty({ example: 5, description: 'How many bots to create at once', minimum: 1, maximum: 50 })
  @IsInt()
  @Min(1)
  @Max(50)
  count: number;

  @ApiPropertyOptional({
    example: 'Bot',
    description: 'Fallback name prefix (e.g. "Bot 3") used once the active Bingo bot name pool runs out',
  })
  @IsOptional()
  @IsString()
  namePrefix?: string;
}

export class ImportBotsCsvDto {
  @ApiProperty({
    description:
      'Raw CSV text. Header row required with a "displayName" column; every other CreateBotDto field name is an optional column.',
  })
  @IsString()
  csv: string;
}
