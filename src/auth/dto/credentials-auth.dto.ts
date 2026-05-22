import { IsString, MinLength } from 'class-validator';

export class CredentialsAuthDto {
  @IsString()
  @MinLength(6)
  phoneNumber: string;

  @IsString()
  @MinLength(8)
  password: string;
}
