import { WerkService } from './werk.service';
import {
  buildLayout,
  simulateBots,
  computeStandings,
  SIM_DT,
  type BotResult,
  type Layout,
} from './sim';
import { buildBotRoster, DEFAULT_WERK_BOTS } from './werk-bots';

/**
 * Unit coverage for the server-authoritative settle path. Everything money- and
 * ranking-relevant is deterministic and DB-free — the seed → layout → bot sim →
 * standings pipeline and the house-edge win controller — so it's tested directly,
 * no MySQL required. (The transactional wrapper in settle() only persists what
 * these pure functions compute.)
 */

const LAYOUT_PARAMS = (botCount: number) => ({
  totalPlayers: 1 + botCount,
  coinDensityX100: 30,
  powerupsEnabled: true,
  botCount,
});

const ROSTER_CFG = {
  botSeedMode: 'auto' as const,
  botSpeedPct: 88,
  botSkillPct: 60,
};

/** Admin-managed DB bot pool (the default seed set) that rosters are drawn from. */
const POOL = DEFAULT_WERK_BOTS;

/** Flood-fill the maze grid to prove every cell is reachable (spanning tree). */
function reachableCells(layout: Layout): number {
  const { size, grid } = layout;
  const seen = new Uint8Array(size * size);
  const stack = [[0, 0] as [number, number]];
  seen[0] = 1;
  let count = 0;
  while (stack.length) {
    const [x, y] = stack.pop()!;
    count++;
    const cell = grid[y][x];
    const nbrs: Array<[number, number]> = [];
    if (!cell.top) nbrs.push([x, y - 1]);
    if (!cell.right) nbrs.push([x + 1, y]);
    if (!cell.bottom) nbrs.push([x, y + 1]);
    if (!cell.left) nbrs.push([x - 1, y]);
    for (const [nx, ny] of nbrs) {
      const id = ny * size + nx;
      if (!seen[id]) { seen[id] = 1; stack.push([nx, ny]); }
    }
  }
  return count;
}

describe('werk layout (buildLayout)', () => {
  it('is deterministic — the same seed rebuilds a byte-identical maze + coins', () => {
    const a = buildLayout(123456, LAYOUT_PARAMS(6));
    const b = buildLayout(123456, LAYOUT_PARAMS(6));
    expect(a.size).toBe(b.size);
    expect(a.coins).toEqual(b.coins);
    expect(a.grid).toEqual(b.grid);
    expect(a.humanSpawn).toEqual(b.humanSpawn);
    expect(a.botSpawns).toEqual(b.botSpawns);
  });

  it('scales the maze with player count', () => {
    expect(buildLayout(1, LAYOUT_PARAMS(6)).size).toBe(16); // <=10 players
    expect(buildLayout(1, LAYOUT_PARAMS(80)).size).toBe(48); // 81 players → biggest
  });

  it('produces a fully-connected maze (no stranded coins)', () => {
    const layout = buildLayout(987654, LAYOUT_PARAMS(6));
    expect(reachableCells(layout)).toBe(layout.size * layout.size);
  });

  it('assigns unique aligned coin indices, one coin per cell', () => {
    const layout = buildLayout(42, LAYOUT_PARAMS(6));
    layout.coins.forEach((c, i) => expect(c.index).toBe(i));
    const cells = new Set(layout.coins.map((c) => `${c.cx},${c.cy}`));
    expect(cells.size).toBe(layout.coins.length);
  });

  it('drops power-ups when disabled but keeps the coin stream aligned', () => {
    const on = buildLayout(555, LAYOUT_PARAMS(6));
    const off = buildLayout(555, { ...LAYOUT_PARAMS(6), powerupsEnabled: false });
    expect(off.powerups).toHaveLength(0);
    expect(on.powerups.length).toBeGreaterThan(0);
    // Coins are drawn before power-ups, so disabling them must not shift coins.
    expect(off.coins).toEqual(on.coins);
  });
});

describe('werk bot roster (buildBotRoster)', () => {
  it('is deterministic and honours the requested count', () => {
    const a = buildBotRoster(777, 8, ROSTER_CFG, POOL);
    const b = buildBotRoster(777, 8, ROSTER_CFG, POOL);
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
  });

  it('draws bot identities from the DB pool (not from code)', () => {
    const roster = buildBotRoster(777, 8, ROSTER_CFG, POOL);
    const poolNames = new Set(POOL.map((b) => b.name));
    for (const b of roster) expect(poolNames.has(b.name)).toBe(true);
  });

  it('returns an empty roster when the DB pool is empty', () => {
    expect(buildBotRoster(777, 8, ROSTER_CFG, [])).toEqual([]);
  });

  it('honours a per-bot speed/skill override from the pool', () => {
    const pool = [{ name: 'x', nameEn: 'x', color: '#fff', personality: 'gatherer' as const, speedPct: 42, skillPct: 77 }];
    const roster = buildBotRoster(5, 3, ROSTER_CFG, pool); // cycles the single bot
    for (const b of roster) {
      expect(b.speedPct).toBe(42);
      expect(b.skill).toBeCloseTo(0.77, 3);
    }
  });

  it('tracks the admin-set speed/skill (no hardcoded difficulty bands)', () => {
    const roster = buildBotRoster(2024, 24, ROSTER_CFG, POOL);
    const avgSpeed = roster.reduce((s, b) => s + b.speedPct, 0) / roster.length;
    const avgSkill = roster.reduce((s, b) => s + b.skill, 0) / roster.length;
    // Jitter is ±5 / ±0.1 around the admin base (88 / 0.60), so averages sit close.
    expect(avgSpeed).toBeGreaterThan(84);
    expect(avgSpeed).toBeLessThan(92);
    expect(avgSkill).toBeGreaterThan(0.54);
    expect(avgSkill).toBeLessThan(0.66);
    // Every bot stays inside the clamped ranges.
    for (const b of roster) {
      expect(b.speedPct).toBeGreaterThanOrEqual(30);
      expect(b.speedPct).toBeLessThanOrEqual(100);
      expect(b.skill).toBeGreaterThanOrEqual(0);
      expect(b.skill).toBeLessThanOrEqual(1);
    }
  });

  it('weaker admin settings really do produce weaker bots', () => {
    const strong = buildBotRoster(9, 30, { ...ROSTER_CFG, botSpeedPct: 100, botSkillPct: 95 }, POOL);
    const weak = buildBotRoster(9, 30, { ...ROSTER_CFG, botSpeedPct: 40, botSkillPct: 10 }, POOL);
    const avg = (r: typeof strong, k: 'speedPct' | 'skill') => r.reduce((s, b) => s + b[k], 0) / r.length;
    expect(avg(strong, 'speedPct')).toBeGreaterThan(avg(weak, 'speedPct'));
    expect(avg(strong, 'skill')).toBeGreaterThan(avg(weak, 'skill'));
  });

  it('returns an empty roster in zero-seed mode', () => {
    expect(buildBotRoster(1, 8, { ...ROSTER_CFG, botSeedMode: 'zero' }, POOL)).toEqual([]);
  });
});

describe('werk bot simulation (simulateBots)', () => {
  const layout = buildLayout(314159, LAYOUT_PARAMS(6));
  const roster = buildBotRoster(314159, 6, ROSTER_CFG, POOL);
  const cfg = { mode: 'A' as const, durationSec: 45, finalSprintWarningSec: 10 };

  it('is deterministic (identical results for the same seed) — client == server', () => {
    const a = simulateBots(layout, roster, cfg, SIM_DT);
    const b = simulateBots(layout, roster, cfg, SIM_DT);
    expect(a).toEqual(b);
  });

  it('never lets bots collect more than the coin pool (exclusive among bots)', () => {
    const bots = simulateBots(layout, roster, cfg, SIM_DT);
    const poolTotal = layout.coins.reduce((s, c) => s + c.value, 0);
    const botTotal = bots.reduce((s, b) => s + b.coinValue, 0);
    expect(botTotal).toBeLessThanOrEqual(poolTotal);
  });
});

describe('werk standings (computeStandings)', () => {
  const bot = (id: number, coinValue: number, reachedCenter = false): BotResult => ({
    id, name: `b${id}`, nameEn: `b${id}`, color: '#000', coinValue, reachedCenter,
  });

  it('ranks the human by coin value in Mode A', () => {
    const std = computeStandings(
      'A',
      { coinValue: 50, reachedCenter: false, name: 'You', color: '#fff' },
      [bot(1, 40), bot(2, 60), bot(3, 10)],
    );
    expect(std.humanRank).toBe(2); // 60 > 50 > 40 > 10
    expect(std.humanEligible).toBe(true);
  });

  it('shares a rank on a tie and counts the tie', () => {
    const std = computeStandings(
      'A',
      { coinValue: 100, reachedCenter: false, name: 'You', color: '#fff' },
      [bot(1, 100), bot(2, 100), bot(3, 20)],
    );
    expect(std.humanRank).toBe(1);
    expect(std.humanTieCount).toBe(3); // human + two bots all at 100
  });

  it('eliminates a non-center finisher in Mode B and ranks them last', () => {
    const std = computeStandings(
      'B',
      { coinValue: 999, reachedCenter: false, name: 'You', color: '#fff' },
      [bot(1, 10, true), bot(2, 5, true)],
    );
    expect(std.humanEligible).toBe(false);
    expect(std.humanRank).toBe(3); // last of 3 despite the highest coin value
  });
});

describe('werk house win control (applyWinControl)', () => {
  const drawSeed = jest.fn();
  const service = new WerkService(
    {} as never, {} as never, {} as never, {} as never,
    { drawSeed } as never,
    {} as never, {} as never,
  );
  const apply = (
    cfg: Record<string, unknown>,
    s: Record<string, unknown>,
    humanValue: number,
    bots: BotResult[],
    poolTotal: number,
  ) => (service as unknown as {
    applyWinControl: (
      m: unknown, cfg: unknown, s: unknown, hv: number, bots: BotResult[], pool: number,
    ) => Promise<{ bots: BotResult[]; info: Record<string, unknown>; auditLogId: string | null }>;
  }).applyWinControl({}, cfg, s, humanValue, bots, poolTotal);

  const mkBots = (...vals: number[]): BotResult[] =>
    vals.map((v, i) => ({ id: i + 1, name: `b${i}`, nameEn: `b${i}`, color: '#000', coinValue: v, reachedCenter: false }));

  beforeEach(() => {
    drawSeed.mockReset();
    drawSeed.mockResolvedValue({ numbers: [123456789], auditLogId: 'audit-1' });
  });

  it('is a no-op when win control is disabled', async () => {
    const bots = mkBots(1, 2, 3);
    const out = await apply(
      { winControlEnabled: false, houseGuaranteedBelowPlayers: 10, botForcedWinEveryNRounds: 4 },
      { id: 's1', totalPlayers: 4, mode: 'A' },
      500, bots, 10000,
    );
    expect(out.bots).toBe(bots); // untouched reference
    expect(out.info.forced).toBe(false);
    expect(drawSeed).not.toHaveBeenCalled();
  });

  it('small games: the house always wins — every bot is pushed above the human', async () => {
    const humanValue = 200;
    const out = await apply(
      { winControlEnabled: true, houseGuaranteedBelowPlayers: 10, botForcedWinEveryNRounds: 4, winControlCounter: 0 },
      { id: 's2', totalPlayers: 4, mode: 'A' }, // 4 < 10 → small
      humanValue, mkBots(0, 10, 5), 100000,
    );
    expect(out.info.forced).toBe(true);
    expect(out.info.mode).toBe('all');
    for (const b of out.bots) expect(b.coinValue).toBeGreaterThan(humanValue);
    const std = computeStandings(
      'A', { coinValue: humanValue, reachedCenter: true, name: 'You', color: '#fff' }, out.bots,
    );
    expect(std.humanRank).toBe(out.bots.length + 1); // dead last
  });

  it('large games: forces exactly one random bot above the human every Nth round', async () => {
    const cfg = { winControlEnabled: true, houseGuaranteedBelowPlayers: 10, botForcedWinEveryNRounds: 4, winControlCounter: 3 };
    const humanValue = 300;
    const out = await apply(
      cfg, { id: 's3', totalPlayers: 20, mode: 'A' }, humanValue, mkBots(10, 20, 30, 40), 100000,
    );
    expect(out.info.forced).toBe(true);
    expect(out.info.mode).toBe('one');
    expect(cfg.winControlCounter).toBe(0); // reset after firing
    const above = out.bots.filter((b) => b.coinValue > humanValue);
    expect(above).toHaveLength(1);
    const std = computeStandings(
      'A', { coinValue: humanValue, reachedCenter: true, name: 'You', color: '#fff' }, out.bots,
    );
    expect(std.humanRank).toBeGreaterThan(1); // human denied first place
  });

  it('large games: only increments the counter on non-firing rounds (human can win)', async () => {
    const cfg = { winControlEnabled: true, houseGuaranteedBelowPlayers: 10, botForcedWinEveryNRounds: 4, winControlCounter: 0 };
    const bots = mkBots(10, 20, 30);
    const out = await apply(cfg, { id: 's4', totalPlayers: 20, mode: 'A' }, 500, bots, 100000);
    expect(out.info.forced).toBe(false);
    expect(cfg.winControlCounter).toBe(1);
    expect(out.bots).toBe(bots); // no boost applied
    expect(drawSeed).not.toHaveBeenCalled();
  });

  it('clamps a forced boost to the coin pool (never mints coins out of thin air)', async () => {
    const poolTotal = 250;
    const out = await apply(
      { winControlEnabled: true, houseGuaranteedBelowPlayers: 10, botForcedWinEveryNRounds: 4, winControlCounter: 3 },
      { id: 's5', totalPlayers: 20, mode: 'A' }, 240, mkBots(10, 20, 30, 40), poolTotal,
    );
    for (const b of out.bots) expect(b.coinValue).toBeLessThanOrEqual(poolTotal);
  });

  it('records an RNG audit id whenever it forces an outcome', async () => {
    const out = await apply(
      { winControlEnabled: true, houseGuaranteedBelowPlayers: 10, botForcedWinEveryNRounds: 4, winControlCounter: 0 },
      { id: 's6', totalPlayers: 4, mode: 'A' }, 100, mkBots(1, 2), 100000,
    );
    expect(out.auditLogId).toBe('audit-1');
    expect(drawSeed).toHaveBeenCalledTimes(1);
  });
});
