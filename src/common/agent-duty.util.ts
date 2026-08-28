/**
 * Agent on-duty / working-hours evaluation.
 *
 * All working hours are interpreted as **Ethiopia local time (UTC+3, no DST)**
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
export function ethiopiaWallClock(at: Date = new Date()): {
    dayOfWeek: number;
    minutes: number;
} {
    const shifted = new Date(at.getTime() + ETHIOPIA_UTC_OFFSET_MIN * 60_000);
    return {
        dayOfWeek: shifted.getUTCDay(),
        minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    };
}

/**
 * Calendar-aligned window starts for agent earnings dashboards, in Ethiopia
 * local time  "today" since local midnight, "this week" since the most
 * recent Monday, "this month" since the 1st. Returned as real UTC `Date`
 * instants (safe to compare against DB `createdAt` columns directly), using
 * the same shift-then-read-UTC-fields trick as `ethiopiaWallClock` above.
 */
export function getEarningsWindowStarts(now: Date = new Date()): {
    todayStart: Date;
    weekStart: Date;
    monthStart: Date;
} {
    const shifted = new Date(now.getTime() + ETHIOPIA_UTC_OFFSET_MIN * 60_000);
    const offsetMs = ETHIOPIA_UTC_OFFSET_MIN * 60_000;

    const localMidnight = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
    );
    const todayStart = new Date(localMidnight - offsetMs);

    const dayOfWeek = shifted.getUTCDay(); // 0=Sun..6=Sat
    const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon->0, Sun->6
    const weekStart = new Date(
        localMidnight - daysSinceMonday * 86_400_000 - offsetMs,
    );

    const localMonthStart = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        1,
    );
    const monthStart = new Date(localMonthStart - offsetMs);

    return { todayStart, weekStart, monthStart };
}

/**
 * Is `at` inside the agent's configured working window (Ethiopia time)?
 * - Empty/absent `workDaysOfWeek` = every day.
 * - Absent start/end hours = available all day (on the allowed days).
 * - Overnight windows (end < start, e.g. 20:00–02:00) are handled.
 */
export function isWithinWorkingWindow(
    agent: WorkingWindowAgent,
    at: Date = new Date(),
): boolean {
    const { dayOfWeek, minutes } = ethiopiaWallClock(at);

    const days = agent.workDaysOfWeek ?? [];
    if (days.length > 0 && !days.includes(dayOfWeek)) return false;

    if (agent.workStartHour == null || agent.workEndHour == null) return true;

    const start = agent.workStartHour * 60 + (agent.workStartMinute ?? 0);
    const end = agent.workEndHour * 60 + (agent.workEndMinute ?? 0);
    if (start === end) return true; // a zero-length window means "all day"

    const overnight = end < start;
    return overnight
        ? minutes >= start || minutes < end
        : minutes >= start && minutes < end;
}

/**
 * Effective on-duty state: the manual mode wins over the schedule.
 * - `on`  → forced on (override)
 * - `off` → forced off (override)
 * - `auto` (default) → follow the working window.
 */
export function isAgentEffectivelyOnDuty(
    agent: WorkingWindowAgent,
    at: Date = new Date(),
): boolean {
    const mode = (agent.onDutyMode ?? 'auto') as AgentDutyMode;
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return isWithinWorkingWindow(agent, at);
}

/**
 * When a window (same shape as WorkingWindowAgent, e.g. the withdrawal
 * schedule in SystemConfig) next opens, given it is CLOSED at `at`. Returns
 * null if it's already open, or if the window has no restriction at all
 * (which would also mean it's always open). Searches forward minute-by-minute
 * up to 7 days rather than re-deriving day/overnight-window math, so it stays
 * correct for every isWithinWorkingWindow case (including overnight windows)
 * by construction  cheap enough since this only runs when showing a
 * "closed, opens at..." message, never on a hot path.
 */
export function getNextWindowOpen(
    window: WorkingWindowAgent,
    at: Date = new Date(),
): Date | null {
    if (isWithinWorkingWindow(window, at)) return null;
    const STEP_MS = 60_000;
    const MAX_STEPS = 7 * 24 * 60; // 7 days
    for (let i = 1; i <= MAX_STEPS; i++) {
        const candidate = new Date(at.getTime() + i * STEP_MS);
        if (isWithinWorkingWindow(window, candidate)) return candidate;
    }
    return null;
}

const WEEKDAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
];

/** Ethiopia-local calendar date only (no time-of-day), as a UTC-epoch-ms day marker for diffing. */
function ethiopiaCalendarDay(at: Date): number {
    const shifted = new Date(at.getTime() + ETHIOPIA_UTC_OFFSET_MIN * 60_000);
    return Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
    );
}

/**
 * Human message for "closed now, opens at `nextOpen`" (e.g. the result of
 * getNextWindowOpen above)  "in N minute(s)/hour(s)" for later today,
 * "tomorrow at HH:MM" for the next calendar day, or "on <Weekday> at HH:MM"
 * further out. Calendar-day boundaries use Ethiopia local time, matching
 * ethiopiaWallClock/isWithinWorkingWindow above.
 */
export function describeNextOpen(nextOpen: Date, now: Date = new Date()): string {
    const dayDiff = Math.round(
        (ethiopiaCalendarDay(nextOpen) - ethiopiaCalendarDay(now)) / 86_400_000,
    );
    const shifted = new Date(nextOpen.getTime() + ETHIOPIA_UTC_OFFSET_MIN * 60_000);
    const timeStr = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;

    if (dayDiff <= 0) {
        const minutesUntil = Math.max(
            1,
            Math.round((nextOpen.getTime() - now.getTime()) / 60_000),
        );
        if (minutesUntil < 60) {
            return `Withdrawals open in ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'}.`;
        }
        const hours = Math.round(minutesUntil / 60);
        return `Withdrawals open in about ${hours} hour${hours === 1 ? '' : 's'}.`;
    }
    if (dayDiff === 1) return `Withdrawals open tomorrow at ${timeStr}.`;
    return `Withdrawals open on ${WEEKDAY_NAMES[shifted.getUTCDay()]} at ${timeStr}.`;
}
