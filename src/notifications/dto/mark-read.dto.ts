import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class MarkReadDto {
  /** Specific notification ids to mark read. Omit to mark ALL of the user's as read. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}
