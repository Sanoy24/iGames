import {
    buildLayout,
    simulateBots,
    computeStandings,
    SIM_DT,
    type BotResult,
    type Layout,
    type WinMode,
} from './sim';
import { buildBotRoster, DEFAULT_WERK_BOTS } from './werk-bots';
import {
    applyRoundWinControl,
    rankParticipants,
    type RoundBot,
    type RoundHuman,
    type WinControlOptions,
} from './round/win-control';

/**
 * Unit coverage for the server-authoritative settle path. Everything money- and
 * ranking-relevant is deterministic and DB-free  the seed → layout → bot sim →
 * standings pipeline and the house-edge win controller  so it's tested directly,
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
            if (!seen[id]) {
                seen[id] = 1;
                stack.push([nx, ny]);
            }
        }
    }
    return count;
}

describe('werk layout (buildLayout)', () => {
    it('is deterministic  the same seed rebuilds a byte-identical maze + coins', () => {
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
        const off = buildLayout(555, {
            ...LAYOUT_PARAMS(6),
            powerupsEnabled: false,
        });
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
        const pool = [
            {
                name: 'x',
                nameEn: 'x',
                color: '#fff',
                personality: 'gatherer' as const,
                speedPct: 42,
                skillPct: 77,
            },
        ];
        const roster = buildBotRoster(5, 3, ROSTER_CFG, pool); // cycles the single bot
        for (const b of roster) {
            expect(b.speedPct).toBe(42);
            expect(b.skill).toBeCloseTo(0.77, 3);
        }
    });

    it('tracks the admin-set speed/skill (no hardcoded difficulty bands)', () => {
        const roster = buildBotRoster(2024, 24, ROSTER_CFG, POOL);
        const avgSpeed =
            roster.reduce((s, b) => s + b.speedPct, 0) / roster.length;
        const avgSkill =
            roster.reduce((s, b) => s + b.skill, 0) / roster.length;
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
        const strong = buildBotRoster(
            9,
            30,
            { ...ROSTER_CFG, botSpeedPct: 100, botSkillPct: 95 },
            POOL,
        );
        const weak = buildBotRoster(
            9,
            30,
            { ...ROSTER_CFG, botSpeedPct: 40, botSkillPct: 10 },
            POOL,
        );
        const avg = (r: typeof strong, k: 'speedPct' | 'skill') =>
            r.reduce((s, b) => s + b[k], 0) / r.length;
        expect(avg(strong, 'speedPct')).toBeGreaterThan(avg(weak, 'speedPct'));
        expect(avg(strong, 'skill')).toBeGreaterThan(avg(weak, 'skill'));
    });

    it('returns an empty roster in zero-seed mode', () => {
        expect(
            buildBotRoster(1, 8, { ...ROSTER_CFG, botSeedMode: 'zero' }, POOL),
        ).toEqual([]);
    });
});

describe('werk bot simulation (simulateBots)', () => {
    const layout = buildLayout(314159, LAYOUT_PARAMS(6));
    const roster = buildBotRoster(314159, 6, ROSTER_CFG, POOL);
    const cfg = {
        mode: 'A' as const,
        durationSec: 45,
        finalSprintWarningSec: 10,
    };

    it('is deterministic (identical results for the same seed)  client == server', () => {
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
    const bot = (
        id: number,
        coinValue: number,
        reachedCenter = false,
    ): BotResult => ({
        id,
        name: `b${id}`,
        nameEn: `b${id}`,
        color: '#000',
        coinValue,
        reachedCenter,
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
            {
                coinValue: 100,
                reachedCenter: false,
                name: 'You',
                color: '#fff',
            },
            [bot(1, 100), bot(2, 100), bot(3, 20)],
        );
        expect(std.humanRank).toBe(1);
        expect(std.humanTieCount).toBe(3); // human + two bots all at 100
    });

    it('eliminates a non-center finisher in Mode B and ranks them last', () => {
        const std = computeStandings(
            'B',
            {
                coinValue: 999,
                reachedCenter: false,
                name: 'You',
                color: '#fff',
            },
            [bot(1, 10, true), bot(2, 5, true)],
        );
        expect(std.humanEligible).toBe(false);
        expect(std.humanRank).toBe(3); // last of 3 despite the highest coin value
    });
});

describe('werk multiplayer win control (applyRoundWinControl)', () => {
    const rng = () => 0.5; // deterministic margins

    const mkOpts = (
        over: Partial<WinControlOptions> = {},
    ): WinControlOptions => ({
        mode: 'A',
        botsEnabled: true,
        realPlayers: 1,
        payingRanks: 3,
        poolTotal: 100_000,
        onboardingEnabled: true,
        onboardingBotWinGames: 2,
        onboardingUserWinGames: 1,
        winControlEnabled: true,
        houseGuaranteedBelowPlayers: 10,
        periodicForceLose: false,
        ...over,
    });

    const human = (
        key: string,
        coinValue: number,
        gamesPlayed: number,
        reachedCenter = true,
    ): RoundHuman => ({ key, coinValue, reachedCenter, gamesPlayed });
    const bot = (
        id: number,
        coinValue: number,
        reachedCenter = true,
    ): RoundBot => ({ id, coinValue, reachedCenter });

    /** Final rank of a specific human key after control + joint ranking. */
    const rankOfHuman = (
        mode: WinMode,
        humans: RoundHuman[],
        bots: RoundBot[],
        key: string,
    ): number => {
        const ranked = rankParticipants(mode, [
            ...humans.map((h) => ({
                key: h.key,
                isHuman: true,
                coinValue: h.coinValue,
                reachedCenter: h.reachedCenter,
            })),
            ...bots.map((b) => ({
                key: `bot:${b.id}`,
                isHuman: false,
                coinValue: b.coinValue,
                reachedCenter: b.reachedCenter,
            })),
        ]);
        return ranked.find((r) => r.key === key)!.rank;
    };

    it('is a no-op when bots are disabled (busy round = pure competition)', () => {
        const bots = [bot(1, 10)];
        const out = applyRoundWinControl(
            rng,
            [human('u1', 50, 0)],
            bots,
            mkOpts({ botsEnabled: false }),
        );
        expect(out.forced).toBe(false);
        expect(out.perHuman.u1).toBe('neutral');
        expect(out.bots).toBe(bots);
    });

    it('onboarding: forces a loss for the first N games (a new user is beaten by bots)', () => {
        for (const games of [0, 1]) {
            const humans = [human('u1', 50, games)];
            const out = applyRoundWinControl(
                rng,
                humans,
                [bot(1, 10), bot(2, 20), bot(3, 30)],
                mkOpts(),
            );
            expect(out.perHuman.u1).toBe('lose');
            // payingRanks (3) bots pushed above the human → out of the paying ranks.
            expect(rankOfHuman('A', humans, out.bots, 'u1')).toBeGreaterThan(3);
        }
    });

    it('onboarding: forces a win after the loss streak (the promised early win)', () => {
        const humans = [human('u1', 50, 2)]; // games 2 → within [B, B+U)
        const out = applyRoundWinControl(
            rng,
            humans,
            [bot(1, 100), bot(2, 200), bot(3, 300)],
            mkOpts(),
        );
        expect(out.perHuman.u1).toBe('win');
        for (const b of out.bots) expect(b.coinValue).toBeLessThan(50);
        expect(rankOfHuman('A', humans, out.bots, 'u1')).toBe(1); // beats every bot
    });

    it('after onboarding: small rounds still let the house win (neutral → forced loss)', () => {
        const humans = [human('u1', 50, 5)];
        const out = applyRoundWinControl(
            rng,
            humans,
            [bot(1, 10), bot(2, 20), bot(3, 30)],
            mkOpts({ realPlayers: 3 }),
        );
        expect(out.perHuman.u1).toBe('lose');
        expect(rankOfHuman('A', humans, out.bots, 'u1')).toBeGreaterThan(3);
    });

    it('after onboarding: large rounds without a periodic trigger do not force (human can win)', () => {
        const humans = [human('u1', 500, 5)];
        const out = applyRoundWinControl(
            rng,
            humans,
            [bot(1, 10), bot(2, 20), bot(3, 30)],
            mkOpts({ realPlayers: 20, periodicForceLose: false }),
        );
        expect(out.perHuman.u1).toBe('neutral');
        expect(out.forced).toBe(false);
        expect(rankOfHuman('A', humans, out.bots, 'u1')).toBe(1);
    });

    it('the full onboarding sequence: lose, lose, win, then neutral', () => {
        const tag = (games: number) =>
            applyRoundWinControl(
                rng,
                [human('u1', 50, games)],
                [bot(1, 10)],
                mkOpts({ realPlayers: 20 }),
            ).perHuman.u1;
        expect([tag(0), tag(1), tag(2), tag(3)]).toEqual([
            'lose',
            'lose',
            'win',
            'neutral',
        ]);
    });

    it('never mints coins: every forced boost is clamped to the pool total', () => {
        const out = applyRoundWinControl(
            rng,
            [human('u1', 55, 0)],
            [bot(1, 10), bot(2, 20), bot(3, 30)],
            mkOpts({ poolTotal: 60 }),
        );
        for (const b of out.bots) expect(b.coinValue).toBeLessThanOrEqual(60);
    });

    it('win precedence: a win-user still beats bots even alongside a lose-user', () => {
        const humans = [human('winner', 40, 2), human('loser', 30, 0)];
        const out = applyRoundWinControl(
            rng,
            humans,
            [bot(1, 100), bot(2, 100)],
            mkOpts({ realPlayers: 2 }),
        );
        expect(out.perHuman.winner).toBe('win');
        expect(rankOfHuman('A', humans, out.bots, 'winner')).toBe(1);
    });
});
