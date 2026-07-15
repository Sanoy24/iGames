import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { SupportRequestType } from '../entities/support-message.entity';

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

  // --- Optional inline tagged request (player endpoint) --------------------
  @IsOptional()
  @IsIn(['complaint', 'dispute', 'refund'])
  requestType?: SupportRequestType;

  /** Required for refund requests, integer minor units. */
  @IsOptional()
  @IsInt()
  @Min(1)
  requestedAmountMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  relatedType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  relatedId?: string;
}
