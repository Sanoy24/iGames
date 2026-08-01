import { ConflictException } from '@nestjs/common';

export type WithdrawalFeeRangeLike = {
  id?: string;
  minAmountMinor: number;
  maxAmountMinor: number | null;
  feeMinor?: number;
};

/** Treats a null `maxAmountMinor` as unbounded (the open-ended top tier). */
function upperBound(range: { maxAmountMinor: number | null }): number {
  return range.maxAmountMinor ?? Infinity;
}

/** Two ranges overlap if their [min, max] intervals intersect at all. */
export function rangesOverlap(a: WithdrawalFeeRangeLike, b: WithdrawalFeeRangeLike): boolean {
  return a.minAmountMinor <= upperBound(b) && b.minAmountMinor <= upperBound(a);
}

/**
 * Throws if `candidate` overlaps any OTHER active range. `excludeId` skips the
 * row being edited (so a range doesn't conflict with its own prior state).
 */
export function assertNoOverlap(
  candidate: WithdrawalFeeRangeLike,
  activeRanges: WithdrawalFeeRangeLike[],
  excludeId?: string,
): void {
  const conflict = activeRanges.find(
    (r) => r.id !== excludeId && rangesOverlap(candidate, r),
  );
  if (conflict) {
    const upper = conflict.maxAmountMinor === null ? 'and above' : `– ${conflict.maxAmountMinor}`;
    throw new ConflictException(
      `Range overlaps an existing active range (${conflict.minAmountMinor} ${upper})`,
    );
  }
}

/**
 * Resolve the flat fee for a withdrawal amount from the active ranges. Throws
 * rather than silently returning 0 when no active range covers the amount —
 * a coverage gap must hard-fail withdrawal completion so it's fixed immediately,
 * not leak fee revenue.
 */
export function resolveWithdrawalFeeMinor(amountMinor: number, activeRanges: WithdrawalFeeRangeLike[]): number {
  const match = activeRanges.find(
    (r) => amountMinor >= r.minAmountMinor && amountMinor <= upperBound(r),
  );
  if (!match || match.feeMinor === undefined) {
    throw new ConflictException(
      'No active withdrawal fee range covers this amount — contact an administrator to fix the fee configuration',
    );
  }
  return match.feeMinor;
}

export type CoverageGap = { fromMinor: number; toMinor: number | null };

/**
 * Informational (non-blocking) gap report: sub-ranges of [floorMinor, ∞) not
 * covered by any active range, including a trailing gap if the highest active
 * range isn't open-ended (no "and above" tier configured).
 */
export function computeCoverageGaps(activeRanges: WithdrawalFeeRangeLike[], floorMinor: number): CoverageGap[] {
  const sorted = [...activeRanges].sort((a, b) => a.minAmountMinor - b.minAmountMinor);
  const gaps: CoverageGap[] = [];
  let cursor = floorMinor;

  for (const range of sorted) {
    if (range.minAmountMinor > cursor) {
      gaps.push({ fromMinor: cursor, toMinor: range.minAmountMinor - 1 });
    }
    cursor = Math.max(cursor, upperBound(range) + 1);
  }

  if (cursor !== Infinity) {
    gaps.push({ fromMinor: cursor, toMinor: null });
  }

  return gaps;
}
