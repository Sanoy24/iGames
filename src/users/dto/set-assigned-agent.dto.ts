import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Exactly one of `agentId` or `other: true` must be supplied — the service
 * rejects both-or-neither. Making "Other" explicit means a client that simply
 * forgets to send `agentId` gets an error instead of silently attributing the
 * player to the house.
 */
export class SetAssignedAgentDto {
  @IsOptional()
  @IsUUID('4')
  agentId?: string;

  @IsOptional()
  @IsBoolean()
  other?: boolean;
}
