import { IsUUID } from 'class-validator';

export class SetUserAgentDto {
    @IsUUID('4')
    agentId: string;
}
