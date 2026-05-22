import { IsString, Matches, MinLength } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @Matches(/^(\+?251|0)[79]\d{8}$/, { message: 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX or +2519XXXXXXXX)' })
  phoneNumber: string;

  @IsString()
  @MinLength(2)
  displayName: string;

  @IsString()
  @MinLength(8)
  password: string;
}
