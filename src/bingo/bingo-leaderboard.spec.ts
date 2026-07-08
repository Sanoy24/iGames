import { BingoRulesService } from './bingo-rules.service';
import { BingoPattern } from './entities/bingo-pattern.entity';
import {
  PrefilledPlace,
  DerashLeaderboardCard,
  rankDerashLeaderboard,
} from './bingo.service';

/**
 * Deterministic leaderboard-ranking tests. These call the SAME pure function
 * `settleDerashLeaderboard` uses (`rankDerashLeaderboard`), so passing here means
 * the live logic ranks identically — no RNG, no DB.
 *
 * Investigation context: a round finished with places going to cartelas
 * #47 (1st), #67 (2nd), #107 (3rd) while #44 — which appeared to make the first
 * single line — won nothing. Scenario A reproduces exactly that and shows it is
 * CORRECT when the winners reach harder patterns. Scenario B shows that if #44 had
 * truly reached the SAME tier as #107 but earlier, #44 would have won — i.e. the
 * comparator is not the culprit.
 */
describe('rankDerashLeaderboard', () => {
  const rules = new BingoRulesService();

  // 5×5 card with a FREE centre. Numbers are arbitrary but unique per card so one
  // card's called numbers never accidentally mark another (the pattern engine only
  // checks whether a cell's value has been drawn).
  const card = (rows: number[][]): (number | null)[][] => {
    const g: (number | null)[][] = rows.map((r) => [...r]);
    g[2][2] = null; // FREE centre
    return g;
  };

  const pat = (id: string, patternType: string): BingoPattern => ({ id, patternType }) as BingoPattern;
  const COVERALL = pat('coverall', 'coverall');       // 1st place — hardest
  const ANY_TWO = pat('any-two', 'any_two_lines');    // 2nd place
  const ANY_LINE = pat('any-line', 'any_line');       // 3rd place — easiest

  const PLACES: PrefilledPlace[] = ['1st', '2nd', '3rd'];
  const PLACE_PATTERN = new Map<PrefilledPlace, BingoPattern>([
    ['1st', COVERALL],
    ['2nd', ANY_TWO],
    ['3rd', ANY_LINE],
  ]);

  // Cards keyed by their number block so draws are isolated:
  //   r0 = block+1..block+5, r1 = block+6..block+10, etc. Centre is FREE.
  const cardForBlock = (block: number) =>
    card([
      [block + 1, block + 2, block + 3, block + 4, block + 5],
      [block + 6, block + 7, block + 8, block + 9, block + 10],
      [block + 11, block + 12, block + 12, block + 13, block + 14], // [2][2] overwritten to FREE
      [block + 15, block + 16, block + 17, block + 18, block + 19],
      [block + 20, block + 21, block + 22, block + 23, block + 24],
    ]);

  const row = (block: number, r: 0 | 1 | 2 | 3 | 4): number[] => {
    const g = cardForBlock(block);
    return g[r].filter((v): v is number => v !== null);
  };
  const allCells = (block: number): number[] =>
    cardForBlock(block).flat().filter((v): v is number => v !== null);

  // Assign places[i] to the i-th ranked card (like settleDerashLeaderboard does).
  const assign = (ranked: { key: number }[]): Record<string, number | undefined> => {
    const out: Record<string, number | undefined> = {};
    PLACES.forEach((p, i) => { out[p] = ranked[i]?.key; });
    return out;
  };

  it('Scenario A: winners reach harder patterns → #44 (first single line) correctly wins nothing', () => {
    const cards: DerashLeaderboardCard[] = [
      { key: 44, grid: cardForBlock(100), order: 0 },
      { key: 47, grid: cardForBlock(200), order: 1 },
      { key: 67, grid: cardForBlock(300), order: 2 },
      { key: 107, grid: cardForBlock(400), order: 3 },
    ];

    // Draw order controls WHEN each card completes:
    //  - #44: only its row 0 (one line) at draw 5, never improves.
    //  - #67: rows 0+1 (two lines) by draw 15.
    //  - #107: rows 0+1 (two lines) by draw 25.
    //  - #47: full house by draw 49 (this ends the round).
    const drawnNumbers = [
      ...row(100, 0),                    // #44 one line @5
      ...row(300, 0), ...row(300, 1),    // #67 two lines @15
      ...row(400, 0), ...row(400, 1),    // #107 two lines @25
      ...allCells(200),                  // #47 full house @49
    ];

    const ranked = rankDerashLeaderboard(rules, cards, drawnNumbers, PLACES, PLACE_PATTERN);

    // Queue order: full house, then the two 'two-line' cards (earliest first), then
    // #44 last (one line only) — beyond the 3 places, so it wins nothing.
    expect(ranked.map((r) => r.key)).toEqual([47, 67, 107, 44]);
    expect(assign(ranked)).toEqual({ '1st': 47, '2nd': 67, '3rd': 107 });

    const winners = ranked.slice(0, PLACES.length).map((r) => r.key);
    expect(winners).not.toContain(44); // matches the video — and it is correct
  });

  it('Scenario B: same tier → the EARLIER card wins (so #44 would beat #107 if both only had one line)', () => {
    const cards: DerashLeaderboardCard[] = [
      { key: 44, grid: cardForBlock(100), order: 0 },
      { key: 107, grid: cardForBlock(400), order: 1 },
      { key: 47, grid: cardForBlock(200), order: 2 },
    ];

    const drawnNumbers = [
      ...row(100, 0),      // #44 one line @5
      ...row(400, 0),      // #107 one line @10 (later than #44)
      ...allCells(200),    // #47 full house @34 (ends the round)
    ];

    const ranked = rankDerashLeaderboard(rules, cards, drawnNumbers, PLACES, PLACE_PATTERN);

    // #44 reached the one-line tier EARLIER than #107, so it is promoted above it.
    expect(ranked.map((r) => r.key)).toEqual([47, 44, 107]);
    expect(assign(ranked)).toEqual({ '1st': 47, '2nd': 44, '3rd': 107 });
  });

  it('cards that complete no enabled pattern are unranked', () => {
    const cards: DerashLeaderboardCard[] = [
      { key: 44, grid: cardForBlock(100), order: 0 },
      { key: 99, grid: cardForBlock(500), order: 1 }, // never has any numbers drawn
      { key: 47, grid: cardForBlock(200), order: 2 },
    ];
    const drawnNumbers = [...row(100, 0), ...allCells(200)];
    const ranked = rankDerashLeaderboard(rules, cards, drawnNumbers, PLACES, PLACE_PATTERN);
    expect(ranked.map((r) => r.key)).toEqual([47, 44]); // #99 omitted
  });

  /**
   * REAL ROUND — fill in from the actual round to get a definitive verdict.
   * 1. Paste #44's and #107's (and any others') 5×5 grids below.
   * 2. Paste the draw order (room.drawnNumbers, in call order).
   * 3. Set PLACE_PATTERN to the room's per-place patterns.
   * 4. Change `it.skip` → `it` and run:  npx jest bingo-leaderboard
   * The assertion will show exactly which cartela SHOULD take each place.
   */
  it.skip('REAL ROUND #44 vs #107 (fill in real grids + draw order)', () => {
    const REAL_PLACE_PATTERN = new Map<PrefilledPlace, BingoPattern>([
      ['1st', pat('1st', 'coverall')],       // <-- set to the room's 1st-place pattern
      ['2nd', pat('2nd', 'any_two_lines')],  // <-- 2nd
      ['3rd', pat('3rd', 'any_line')],       // <-- 3rd
    ]);
    const cards: DerashLeaderboardCard[] = [
      // { key: 44,  grid: card([...5 rows...]), order: <purchase index> },
      // { key: 107, grid: card([...5 rows...]), order: <purchase index> },
      // ...every other in-play card...
    ];
    const drawnNumbers: number[] = [/* the round's called numbers, in order */];

    const ranked = rankDerashLeaderboard(rules, cards, drawnNumbers, PLACES, REAL_PLACE_PATTERN);
    // eslint-disable-next-line no-console
    console.log('Standings:', assign(ranked), 'full queue:', ranked);
    expect(ranked.length).toBeGreaterThan(0);
  });
});
