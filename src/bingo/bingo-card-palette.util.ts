/**
 * The fixed set of lobby card gradient presets (see BingoLobby in Bingo.tsx
 * for the actual color values — kept there since it's pure CSS/display data
 * the backend never needs). This file is the single source of truth for
 * which ids are VALID, so admin input and the random-assignment fallback in
 * BingoService both stay in sync with what the frontend can actually render.
 */
export const BINGO_CARD_PALETTE_IDS = [
  'blue',
  'orange',
  'purple',
  'teal',
  'pink',
  'gold',
] as const;

export type BingoCardPaletteId = (typeof BINGO_CARD_PALETTE_IDS)[number];

export function isValidCardPaletteId(value: unknown): value is BingoCardPaletteId {
  return typeof value === 'string' && (BINGO_CARD_PALETTE_IDS as readonly string[]).includes(value);
}

export function randomCardPaletteId(): BingoCardPaletteId {
  return BINGO_CARD_PALETTE_IDS[Math.floor(Math.random() * BINGO_CARD_PALETTE_IDS.length)];
}

/** A decorative ball number within the room's own ball pool (1..maxNumber). */
export function randomCardBallNumber(maxNumber: number): number {
  return 1 + Math.floor(Math.random() * Math.max(1, maxNumber));
}
