import { IsBoolean } from 'class-validator';

export class SetAgentOnDutyDto {
  @IsBoolean()
  onDuty: boolean;
}
