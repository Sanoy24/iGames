import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  SupportTicketPriority,
  SupportTicketStatus,
} from '../entities/support-ticket.entity';

/** Agent/admin: change status, priority, or (re)assign a ticket. */
export class UpdateTicketDto {
  @IsOptional()
  @IsIn(['open', 'pending_agent', 'pending_user', 'resolved', 'closed'])
  status?: SupportTicketStatus;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: SupportTicketPriority;

  /** Assign to a specific agent user id, or null to unassign. */
  @IsOptional()
  @IsString()
  @MaxLength(36)
  assignedAgentId?: string | null;
}
