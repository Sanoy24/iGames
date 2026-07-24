import { accountMatchesPhone, checkFreshness, normalizeName, parseEatDate } from './receipt-verification';

describe('normalizeName', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeName('  Agent   Sara  ')).toBe('agent sara');
  });
});

describe('accountMatchesPhone', () => {
  it('matches an unmasked account by its last 9 digits', () => {
    expect(accountMatchesPhone('251712345678', '0712345678')).toBe(true);
  });

  it('rejects a definite mismatch', () => {
    expect(accountMatchesPhone('251799999999', '0712345678')).toBe(false);
  });

  it('matches a masked account on the visible trailing digits', () => {
    expect(accountMatchesPhone('0712****678', '+251712345678')).toBe(true);
  });

  it('returns null (indeterminate) when either side is missing', () => {
    expect(accountMatchesPhone(undefined, '0712345678')).toBeNull();
    expect(accountMatchesPhone('0712345678', null)).toBeNull();
  });

  it('returns null when the phone is too short to be canonical', () => {
    expect(accountMatchesPhone('0712345678', '12345')).toBeNull();
  });
});

describe('parseEatDate', () => {
  it('parses DD/MM/YY with AM/PM into the correct UTC instant', () => {
    // 10:15 AM EAT → 07:15 UTC.
    expect(parseEatDate('3/7/26 10:15 AM')?.toISOString()).toBe('2026-07-03T07:15:00.000Z');
  });

  it('parses 24h DD-MM-YYYY HH:mm:ss', () => {
    expect(parseEatDate('03-07-2026 21:05:00')?.toISOString()).toBe('2026-07-03T18:05:00.000Z');
  });

  it('handles 12 PM and 12 AM correctly', () => {
    expect(parseEatDate('1/1/26 12:00 PM')?.toISOString()).toBe('2026-01-01T09:00:00.000Z');
    expect(parseEatDate('1/1/26 12:00 AM')?.toISOString()).toBe('2025-12-31T21:00:00.000Z');
  });

  it('returns null for junk', () => {
    expect(parseEatDate('not a date')).toBeNull();
    expect(parseEatDate(undefined)).toBeNull();
  });
});

describe('checkFreshness', () => {
  const base = new Date('2026-07-03T10:00:00.000Z');

  it('accepts a recent transaction', () => {
    expect(checkFreshness(new Date('2026-07-03T09:50:00.000Z'), base)).toBe('ok');
  });

  it('flags one older than the window', () => {
    expect(checkFreshness(new Date('2026-07-03T09:00:00.000Z'), base)).toBe('too_old');
  });

  it('flags one in the future beyond the skew tolerance', () => {
    expect(checkFreshness(new Date('2026-07-03T10:10:00.000Z'), base)).toBe('future');
  });

  it('tolerates small clock skew', () => {
    expect(checkFreshness(new Date('2026-07-03T10:03:00.000Z'), base)).toBe('ok');
  });
});
