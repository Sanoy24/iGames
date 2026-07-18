import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTournamentDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
