import { Color, GameState, RuleConfig, Token, TokenPos } from './types';

/** Entry cell onto the 52-cell main track for each color. */
export const ENTRY_CELL: Record<Color, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

export const TRACK_LENGTH = 52;
export const HOME_COLUMN_LENGTH = 6;

/** Entry cells + star cells. A token here can never be captured. */
export const SAFE_CELLS = new Set<number>([0, 13, 26, 39, 8, 21, 34, 47]);

export function isSafeCell(index: number): boolean {
  return SAFE_CELLS.has(index);
}

/** Last main-track cell before a color's home column. */
export function lastTrackCell(color: Color): number {
  return (ENTRY_CELL[color] - 1 + TRACK_LENGTH) % TRACK_LENGTH;
}

export function progressOf(color: Color, index: number): number {
  return (index - ENTRY_CELL[color] + TRACK_LENGTH) % TRACK_LENGTH;
}

export function canExitBase(steps: number, config: RuleConfig): boolean {
  if (steps === 6) return true;
  return !config.exitOnSixOnly && steps === 1;
}

/**
 * Pure movement math for one token. Returns null when the move is illegal
 * (overshoot, no exit roll from base, already home). Does not check capture,
 * blocking, or turn ownership — see rules.ts for the full move pipeline.
 */
export function computeNewPos(color: Color, pos: TokenPos, steps: number, config: RuleConfig): TokenPos | null {
  if (pos.zone === 'base') {
    return canExitBase(steps, config) ? { zone: 'track', index: ENTRY_CELL[color] } : null;
  }

  if (pos.zone === 'track') {
    const progress = progressOf(color, pos.index);
    const newProgress = progress + steps;
    if (newProgress <= 50) {
      return { zone: 'track', index: (ENTRY_CELL[color] + newProgress) % TRACK_LENGTH };
    }
    if (newProgress <= 56) {
      return { zone: 'homecol', index: newProgress - 51 };
    }
    return null; // overshoots home
  }

  if (pos.zone === 'homecol') {
    const newIndex = pos.index + steps;
    if (newIndex === HOME_COLUMN_LENGTH) return { zone: 'home' };
    if (newIndex < HOME_COLUMN_LENGTH) return { zone: 'homecol', index: newIndex };
    return null; // overshoots home
  }

  return null; // already home
}

/**
 * All global track cells a token passes through (exclusive of the starting
 * cell, inclusive of the destination) when moving `steps` forward from
 * `fromIndex`. Only meaningful while the token stays on the main track.
 */
export function trackCellsTraversed(color: Color, fromIndex: number, steps: number): number[] {
  const cells: number[] = [];
  const startProgress = progressOf(color, fromIndex);
  for (let i = 1; i <= steps; i += 1) {
    const p = startProgress + i;
    if (p > 50) break; // entered home column, no longer a track cell
    cells.push((ENTRY_CELL[color] + p) % TRACK_LENGTH);
  }
  return cells;
}

/** A "block" is 2+ same-color tokens occupying one non-safe track cell. */
export function isBlockedForOthers(tokens: Token[], atCell: number, movingColor: Color): boolean {
  if (isSafeCell(atCell)) return false;
  const byColor = new Map<Color, number>();
  for (const t of tokens) {
    if (t.color === movingColor) continue;
    if (t.pos.zone === 'track' && t.pos.index === atCell) {
      byColor.set(t.color, (byColor.get(t.color) ?? 0) + 1);
    }
  }
  for (const count of byColor.values()) {
    if (count >= 2) return true;
  }
  return false;
}

export function findTokensAtCell(state: GameState, index: number): Token[] {
  return state.tokens.filter((t) => t.pos.zone === 'track' && t.pos.index === index);
}
