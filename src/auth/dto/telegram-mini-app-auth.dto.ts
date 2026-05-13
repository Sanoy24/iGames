import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TelegramMiniAppAuthDto {
  @ApiProperty({
    description: 'Raw Telegram.WebApp.initData query string from the Mini App frontend.'
  })
  @IsString()
  @IsNotEmpty()
  initData: string;
}
