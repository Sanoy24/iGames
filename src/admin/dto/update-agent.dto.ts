import { IsString, Matches, MinLength, IsOptional, IsNumber, Min, Max, IsObject } from 'class-validator';

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\+?251|0)[79]\d{8}$/, { message: 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX or +2519XXXXXXXX)' })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsOptional()
  password?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  workStartHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(59)
  workStartMinute?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  workEndHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(59)
  workEndMinute?: number;

  @IsOptional()
  @IsObject()
  agentPermissions?: {
    deposit: boolean;
    withdraw: boolean;
  };

  @IsOptional()
  @IsString()
  status?: 'active' | 'suspended' | 'closed';
}
