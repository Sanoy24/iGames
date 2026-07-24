import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitMpesaSmsDto {
  @ApiProperty({
    description: 'The full M-PESA confirmation SMS text, pasted by the player.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  sms: string;
}
