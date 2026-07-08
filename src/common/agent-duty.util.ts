/**
 * Agent on-duty / working-hours evaluation.
 *
 * All working hours are interpreted as **Ethiopia local time (UTC+3, no DST)** —
 * never the server clock, which on most hosts is UTC and caused the original
 * "no agent on duty" bug. We shift the instant by +180 minutes and read the UTC
 * wall-clock off the shifted date, which yields Ethiopia local values regardless
 * of where the server runs.
 */

export const ETHIOPIA_UTC_OFFSET_MIN = 180; // UTC+3, no daylight saving

export type AgentDutyMode = 'auto' | 'on' | 'off';

export type WorkingWindowAgent = {
  workStartHour?: number | null;
  workStartMinute?: number | null;
  workEndHour?: number | null;
  workEndMinute?: number | null;
  workDaysOfWeek?: number[] | null;
  onDutyMode?: string | null; // AgentDutyMode
};

/** Ethiopia wall-clock day-of-week (0=Sun..6=Sat) and minutes-since-midnight. */
export function ethiopiaWallClock(at: Date = new Date()): { dayOfWeek: number; minutes: number } {
  const shifted = new Date(at.getTime() + ETHIOPIA_UTC_OFFSET_MIN * 60_000);
  return {
    dayOfWeek: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/**
 * Is `at` inside the agent's configured working window (Ethiopia time)?
 * - Empty/absent `workDaysOfWeek` = every day.
 * - Absent start/end hours = available all day (on the allowed days).
 * - Overnight windows (end < start, e.g. 20:00–02:00) are handled.
 */
export function isWithinWorkingWindow(agent: WorkingWindowAgent, at: Date = new Date()): boolean {
  const { dayOfWeek, minutes } = ethiopiaWallClock(at);

  const days = agent.workDaysOfWeek ?? [];
  if (days.length > 0 && !days.includes(dayOfWeek)) return false;

  if (agent.workStartHour == null || agent.workEndHour == null) return true;

  const start = agent.workStartHour * 60 + (agent.workStartMinute ?? 0);
  const end = agent.workEndHour * 60 + (agent.workEndMinute ?? 0);
  if (start === end) return true; // a zero-length window means "all day"

  const overnight = end < start;
  return overnight ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}

/**
 * Effective on-duty state: the manual mode wins over the schedule.
 * - `on`  → forced on (override)
 * - `off` → forced off (override)
 * - `auto` (default) → follow the working window.
 */
export function isAgentEffectivelyOnDuty(agent: WorkingWindowAgent, at: Date = new Date()): boolean {
  const mode = (agent.onDutyMode ?? 'auto') as AgentDutyMode;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return isWithinWorkingWindow(agent, at);
}
