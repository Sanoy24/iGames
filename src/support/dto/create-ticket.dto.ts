import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import type { SupportTicketCategory } from '../entities/support-ticket.entity';

/**
 * Categories a player is allowed to open directly. `live_chat` tickets are
 * created through the gateway, not this endpoint.
 */
export const PLAYER_TICKET_CATEGORIES: SupportTicketCategory[] = [
  'general',
  'complaint',
  'dispute',
  'refund',
];

export class CreateTicketDto {
  @IsIn(PLAYER_TICKET_CATEGORIES)
  category: SupportTicketCategory;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  /** First message of the thread. */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  // --- Dispute / refund linkage (optional) --------------------------------
  @IsOptional()
  @IsString()
  @MaxLength(40)
  relatedType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  relatedId?: string;

  /** Required-ish for refunds: how much the player is asking back, minor units. */
  @IsOptional()
  @IsInt()
  @Min(1)
  requestedAmountMinor?: number;
}
