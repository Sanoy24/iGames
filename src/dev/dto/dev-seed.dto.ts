import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class DevSeedDto {
  @ApiPropertyOptional({
    example: 'Test Admin',
    description: 'Display name for the seeded user',
    default: 'Dev Admin'
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  displayName?: string;

  @ApiPropertyOptional({
    example: ['admin', 'player'],
    description: 'Roles to assign',
    default: ['admin', 'player']
  })
  @IsOptional()
  @IsArray()
  @IsEnum(['admin', 'player', 'system'], { each: true })
  roles?: string[];

  @ApiPropertyOptional({
    example: 100000,
    description: 'Initial balance in minor units',
    default: 0
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  initialBalanceMinor?: number;
}
