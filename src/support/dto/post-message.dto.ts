import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PostMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  @IsOptional()
  @IsArray()
  attachments?: Record<string, unknown>[];

  /**
   * Agent-only: mark this message as an internal note invisible to the player.
   * Ignored on the player endpoint.
   */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
