import { ConflictException } from '@nestjs/common';
import {
  rangesOverlap,
  assertNoOverlap,
  resolveWithdrawalFeeMinor,
  computeCoverageGaps,
} from './withdrawal-fee-range.util';

const range = (minAmountMinor: number, maxAmountMinor: number | null, feeMinor = 0, id?: string) => ({
  id,
  minAmountMinor,
  maxAmountMinor,
  feeMinor,
});

describe('rangesOverlap', () => {
  it('detects overlap between two closed ranges', () => {
    expect(rangesOverlap(range(0, 500), range(400, 1000))).toBe(true);
  });

  it('detects adjacency as non-overlapping', () => {
    expect(rangesOverlap(range(0, 500), range(501, 1000))).toBe(false);
  });

  it('treats a null max as unbounded, so any range above it overlaps', () => {
    expect(rangesOverlap(range(10000, null), range(50000, 60000))).toBe(true);
  });

  it('two open-ended ranges always overlap', () => {
    expect(rangesOverlap(range(0, null), range(10000, null))).toBe(true);
  });
});

describe('assertNoOverlap', () => {
  it('does not throw when there is no conflict', () => {
    expect(() => assertNoOverlap(range(501, 1000), [range(0, 500, 0, 'a')])).not.toThrow();
  });

  it('throws ConflictException naming the conflicting range', () => {
    expect(() => assertNoOverlap(range(400, 1000), [range(0, 500, 0, 'a')])).toThrow(ConflictException);
  });

  it('excludes the row being edited from the check', () => {
    expect(() => assertNoOverlap(range(0, 600, 0, 'a'), [range(0, 500, 0, 'a')], 'a')).not.toThrow();
  });
});

describe('resolveWithdrawalFeeMinor', () => {
  const ranges = [range(1, 50000, 1000, 'a'), range(50001, null, 10000, 'b')];

  it('resolves the matching lower tier', () => {
    expect(resolveWithdrawalFeeMinor(25000, ranges)).toBe(1000);
  });

  it('resolves the open-ended top tier', () => {
    expect(resolveWithdrawalFeeMinor(1000000, ranges)).toBe(10000);
  });

  it('throws when no active range covers the amount (a gap)', () => {
    const gappy = [range(1, 500, 10, 'a'), range(1001, null, 100, 'b')];
    expect(() => resolveWithdrawalFeeMinor(700, gappy)).toThrow(ConflictException);
  });
});

describe('computeCoverageGaps', () => {
  it('reports no gaps for a complete, open-ended tiling', () => {
    const ranges = [range(1, 50000, 1000), range(50001, null, 10000)];
    expect(computeCoverageGaps(ranges, 1)).toEqual([]);
  });

  it('reports a middle gap', () => {
    const ranges = [range(1, 500, 10), range(1001, null, 100)];
    expect(computeCoverageGaps(ranges, 1)).toEqual([{ fromMinor: 501, toMinor: 1000 }]);
  });

  it('reports a trailing gap when there is no open-ended top tier', () => {
    const ranges = [range(1, 500, 10)];
    expect(computeCoverageGaps(ranges, 1)).toEqual([{ fromMinor: 501, toMinor: null }]);
  });

  it('reports the whole range as a gap when nothing is configured', () => {
    expect(computeCoverageGaps([], 1)).toEqual([{ fromMinor: 1, toMinor: null }]);
  });
});
