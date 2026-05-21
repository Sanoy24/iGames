import { IsEmail, IsString, MinLength } from 'class-validator';

export class CredentialsAuthDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
