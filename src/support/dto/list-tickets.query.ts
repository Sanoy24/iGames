import { IsIn, IsOptional, IsString } from 'class-validator';
import type {
  SupportTicketCategory,
  SupportTicketStatus,
} from '../entities/support-ticket.entity';

/** Agent/admin inbox filters. All optional; omitted filters match everything. */
export class ListTicketsQuery {
  @IsOptional()
  @IsIn(['open', 'pending_agent', 'pending_user', 'resolved', 'closed'])
  status?: SupportTicketStatus;

  @IsOptional()
  @IsIn(['general', 'complaint', 'dispute', 'refund', 'live_chat'])
  category?: SupportTicketCategory;

  /** Filter to tickets assigned to a specific agent, or "me" for the caller. */
  @IsOptional()
  @IsString()
  assignedAgentId?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
