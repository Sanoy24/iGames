import { IsString, Matches, MinLength, IsOptional, IsNumber, Min, Max, IsObject, IsArray } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @Matches(/^(\+?251|0)[79]\d{8}$/, { message: 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX or +2519XXXXXXXX)' })
  phoneNumber: string;

  /** M-Pesa deposit destination, if different from phoneNumber above. Blank = players send M-Pesa to phoneNumber too. */
  @IsOptional()
  @IsString()
  @Matches(/^(\+?251|0)[79]\d{8}$/, { message: 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX or +2519XXXXXXXX)' })
  mpesaPhoneNumber?: string;

  @IsString()
  @MinLength(2)
  displayName: string;

  @IsString()
  @MinLength(8)
  password: string;

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

  /** Days the agent works (0=Sun..6=Sat). Empty = every day. */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workDaysOfWeek?: number[];

  @IsOptional()
  @IsObject()
  agentPermissions?: {
    deposit: boolean;
    withdraw: boolean;
  };
}
