import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import type { GameState } from '../entities/game-setting.entity';

export class UpdateGameSettingDto {
  @IsOptional()
  @IsIn(['enabled', 'maintenance', 'hidden'])
  state?: GameState;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  maintenanceMessage?: string | null;

  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
