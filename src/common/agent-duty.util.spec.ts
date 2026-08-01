import { getEarningsWindowStarts } from './agent-duty.util';

describe('getEarningsWindowStarts', () => {
  it('resolves today-start to Ethiopia local midnight (UTC+3), just after crossing the day boundary', () => {
    // 2026-08-02T00:00:01Z UTC == 2026-08-02T03:00:01 Ethiopia local — a second
    // past local midnight. todayStart should be the UTC instant of that midnight.
    const now = new Date('2026-08-02T00:00:01Z');
    const { todayStart } = getEarningsWindowStarts(now);
    expect(todayStart.toISOString()).toBe('2026-08-01T21:00:00.000Z');
  });

  it('does not roll today-start forward when just before Ethiopia local midnight', () => {
    // 2026-08-01T20:59:59Z == 2026-08-01T23:59:59 Ethiopia local — still "today" (Aug 1).
    const now = new Date('2026-08-01T20:59:59Z');
    const { todayStart } = getEarningsWindowStarts(now);
    expect(todayStart.toISOString()).toBe('2026-07-31T21:00:00.000Z');
  });

  it('resolves week-start to the most recent Monday local midnight', () => {
    // 2026-08-05 is a Wednesday (Ethiopia local); Monday is 2026-08-03.
    const now = new Date('2026-08-05T10:00:00Z');
    const { weekStart } = getEarningsWindowStarts(now);
    expect(weekStart.toISOString()).toBe('2026-08-02T21:00:00.000Z');
  });

  it('keeps week-start on the same day when local time is already Monday', () => {
    const now = new Date('2026-08-03T10:00:00Z'); // Monday Ethiopia local
    const { weekStart } = getEarningsWindowStarts(now);
    expect(weekStart.toISOString()).toBe('2026-08-02T21:00:00.000Z');
  });

  it('resolves month-start to the 1st of the Ethiopia-local month', () => {
    const now = new Date('2026-08-15T10:00:00Z');
    const { monthStart } = getEarningsWindowStarts(now);
    expect(monthStart.toISOString()).toBe('2026-07-31T21:00:00.000Z');
  });
});
