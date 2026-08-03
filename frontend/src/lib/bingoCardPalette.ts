// Lobby card gradient presets — ids must match BINGO_CARD_PALETTE_IDS in the
// backend (src/bingo/bingo-card-palette.util.ts), which is what validates and
// randomly assigns them. Kept here (not shared code) since it's pure display
// data the backend never needs to know the actual color values of.
export type BingoCardPaletteId = 'blue' | 'orange' | 'purple' | 'teal' | 'pink' | 'gold';

export type BingoCardPalette = {
  id: BingoCardPaletteId;
  label: string;
  gradient: string; // CSS background value
  ballGradient: string;
};

export const BINGO_CARD_PALETTES: Record<BingoCardPaletteId, BingoCardPalette> = {
  blue: {
    id: 'blue',
    label: 'Blue',
    gradient: 'linear-gradient(135deg, #38bdf8 0%, #1d4ed8 100%)',
    ballGradient: 'radial-gradient(circle at 35% 30%, #5eead4, #0f766e)',
  },
  orange: {
    id: 'orange',
    label: 'Orange',
    gradient: 'linear-gradient(135deg, #fb923c 0%, #c2410c 100%)',
    ballGradient: 'radial-gradient(circle at 35% 30%, #fde047, #ca8a04)',
  },
  purple: {
    id: 'purple',
    label: 'Purple',
    gradient: 'linear-gradient(135deg, #c084fc 0%, #a21caf 100%)',
    ballGradient: 'radial-gradient(circle at 35% 30%, #d8b4fe, #7e22ce)',
  },
  teal: {
    id: 'teal',
    label: 'Teal',
    gradient: 'linear-gradient(135deg, #2dd4bf 0%, #15803d 100%)',
    ballGradient: 'radial-gradient(circle at 35% 30%, #86efac, #15803d)',
  },
  pink: {
    id: 'pink',
    label: 'Pink',
    gradient: 'linear-gradient(135deg, #fb7185 0%, #b91c1c 100%)',
    ballGradient: 'radial-gradient(circle at 35% 30%, #fda4af, #be123c)',
  },
  gold: {
    id: 'gold',
    label: 'Gold',
    gradient: 'linear-gradient(135deg, #60a5fa 0%, #1e3a8a 100%)',
    ballGradient: 'radial-gradient(circle at 35% 30%, #5eead4, #0f766e)',
  },
};

export const BINGO_CARD_PALETTE_IDS = Object.keys(BINGO_CARD_PALETTES) as BingoCardPaletteId[];

export function getBingoCardPalette(id: string | null | undefined): BingoCardPalette {
  if (id && id in BINGO_CARD_PALETTES) return BINGO_CARD_PALETTES[id as BingoCardPaletteId];
  return BINGO_CARD_PALETTES.blue;
}
