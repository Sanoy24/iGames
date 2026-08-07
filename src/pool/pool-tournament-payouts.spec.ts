import { computeTournamentPayouts } from './pool-tournament.service';

const tiers = (
    w1: number,
    w2: number,
    w34: number,
    semis: string[] = ['c', 'd'],
    runnerUp = 'b',
) => [
    { place: 1, weight: w1, players: ['a'] },
    { place: 2, weight: w2, players: runnerUp ? [runnerUp] : [] },
    { place: 3, weight: w34, players: semis },
];

const total = (rows: Array<{ amountMinor: number }>) =>
    rows.reduce((s, r) => s + r.amountMinor, 0);

describe('computeTournamentPayouts', () => {
    it('winner-take-all (100/0/0) pays the whole pool to 1st', () => {
        const out = computeTournamentPayouts(1000, tiers(100, 0, 0));
        expect(out).toEqual([{ userId: 'a', amountMinor: 1000, place: 1 }]);
    });

    it('splits across 1st/2nd/3rd-4th by weight and equalises the tied tier', () => {
        // pool 1000, weights 70/20/10 → 700 / 200 / (100 split → 50 each)
        const out = computeTournamentPayouts(1000, tiers(70, 20, 10));
        const map = Object.fromEntries(
            out.map((r) => [r.userId, r.amountMinor]),
        );
        expect(map).toEqual({ a: 700, b: 200, c: 50, d: 50 });
        expect(total(out)).toBe(1000);
    });

    it('never mints or loses money  winner absorbs the rounding remainder', () => {
        // 1001 with 70/20/10: 700 / 200 / floor(100/2)=50 each = 1000; remainder 1 → winner
        const out = computeTournamentPayouts(1001, tiers(70, 20, 10));
        const map = Object.fromEntries(
            out.map((r) => [r.userId, r.amountMinor]),
        );
        expect(map.a).toBe(701);
        expect(total(out)).toBe(1001);
    });

    it('ignores tiers with no finishers (small bracket) and redistributes their weight', () => {
        // A 2-player event: no semi losers. 70/20/10 with empty 3rd-4th → split 70/20 only.
        const out = computeTournamentPayouts(900, tiers(70, 20, 10, [], 'b'));
        const map = Object.fromEntries(
            out.map((r) => [r.userId, r.amountMinor]),
        );
        // active weight = 90; a = floor(900*70/90)=700, b = floor(900*20/90)=200, +0 remainder
        expect(map).toEqual({ a: 700, b: 200 });
        expect(total(out)).toBe(900);
    });

    it('falls back to winner-take-all when all weights are zero', () => {
        const out = computeTournamentPayouts(500, tiers(0, 0, 0));
        expect(out).toEqual([{ userId: 'a', amountMinor: 500, place: 1 }]);
    });

    it('pays nothing when the pool is zero', () => {
        expect(computeTournamentPayouts(0, tiers(100, 0, 0))).toEqual([]);
    });
});
