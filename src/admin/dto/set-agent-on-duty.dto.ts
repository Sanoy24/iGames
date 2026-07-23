import { IsIn } from 'class-validator';
import type { AgentDutyMode } from '../../common/agent-duty.util';

export class SetAgentOnDutyDto {
  /** 'auto' follows the working schedule; 'on'/'off' are manual overrides. */
  @IsIn(['auto', 'on', 'off'])
  mode: AgentDutyMode;
}
