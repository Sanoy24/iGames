import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBotNameDto {
  @ApiProperty({ example: 'Abebe', description: 'Unique bot name shown inside Bingo games' })
  @IsString()
  @MaxLength(255)
  displayName: string;

  @ApiPropertyOptional({ example: true, description: 'Whether this name can be assigned to new games' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ImportBotNamesDto {
  @ApiProperty({
    example: ['Abebe', 'Hana', 'Samuel'],
    description: 'List of bot names to import; duplicates are ignored',
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  names: string[];
}
