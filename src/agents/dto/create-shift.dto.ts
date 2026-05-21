import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateShiftDto {
  @IsString()
  agentId: string;

  @IsInt() @Min(0) @Max(23)
  startHour: number;

  @IsInt() @Min(0) @Max(59)
  startMinute: number;

  @IsInt() @Min(0) @Max(23)
  endHour: number;

  @IsInt() @Min(0) @Max(59)
  endMinute: number;

  // 0=Sun…6=Sat. Omit or pass [] for every day.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
