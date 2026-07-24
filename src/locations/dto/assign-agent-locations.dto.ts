import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

export class AssignAgentLocationsDto {
  /** Replaces the agent's whole assignment set. An empty array unassigns them. */
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  locationIds: string[];

  /** Must be one of `locationIds`. Marks the agent's home location. */
  @IsOptional()
  @IsUUID('4')
  primaryLocationId?: string;
}
