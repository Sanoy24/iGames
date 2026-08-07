import { Ball } from './types';
import { standardTable, footSpot } from './table';
import { rackEightBall } from './rack';
import { runShot } from './simulator';

const table = standardTable();
const R = table.ballRadius;

function cueBall(x: number, y: number): Ball {
    return {
        id: 0,
        number: 0,
        kind: 'cue',
        pos: { x, y },
        vel: { x: 0, y: 0 },
        spin: { x: 0, y: 0, z: 0 },
        pocketed: false,
    };
}
function objectBall(number: number, x: number, y: number): Ball {
    return {
        id: number,
        number,
        kind: number < 8 ? 'solid' : 'stripe',
        pos: { x, y },
        vel: { x: 0, y: 0 },
        spin: { x: 0, y: 0, z: 0 },
        pocketed: false,
    };
}

describe('pool engine  rack', () => {
    it('builds a legal 16-ball rack', () => {
        const balls = rackEightBall(table, 12345);
        expect(balls).toHaveLength(16);
        expect(balls.filter((b) => b.number === 0)).toHaveLength(1);
        expect(new Set(balls.map((b) => b.number)).size).toBe(16);

        // The 8 ball sits on the foot spot's third row centre.
        const foot = footSpot(table);
        const eight = balls.find((b) => b.number === 8)!;
        const rowDx = R * 2 * 1.001 * (Math.sqrt(3) / 2);
        expect(eight.pos.x).toBeCloseTo(foot.x + 2 * rowDx, 5);
        expect(eight.pos.y).toBeCloseTo(foot.y, 5);

        // No two balls overlap at rest.
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const d = Math.hypot(
                    balls[i].pos.x - balls[j].pos.x,
                    balls[i].pos.y - balls[j].pos.y,
                );
                expect(d).toBeGreaterThanOrEqual(2 * R - 1e-9);
            }
        }
    });

    it('is deterministic for a given seed and differs across seeds', () => {
        expect(rackEightBall(table, 42)).toEqual(rackEightBall(table, 42));
        const a = rackEightBall(table, 1).map((b) => b.number);
        const b = rackEightBall(table, 2).map((b) => b.number);
        expect(a).not.toEqual(b);
    });
});

describe('pool engine  simulation', () => {
    it('produces identical results for identical inputs (determinism)', () => {
        const balls = rackEightBall(table, 777);
        const input = {
            angle: 0.02,
            power: 0.95,
            spin: { side: 0.1, vertical: 0.2 },
        };
        const r1 = runShot(balls, input, table);
        const r2 = runShot(balls, input, table);
        expect(r1.balls).toEqual(r2.balls);
        expect(r1.events.length).toBe(r2.events.length);
        expect(r1.steps).toBe(r2.steps);
    });

    it("does not mutate the caller's ball array", () => {
        const balls = rackEightBall(table, 5);
        const snapshot = JSON.stringify(balls);
        runShot(
            balls,
            { angle: 0, power: 1, spin: { side: 0, vertical: 0 } },
            table,
        );
        expect(JSON.stringify(balls)).toBe(snapshot);
    });

    it('a break scatters the rack and everything comes to rest inside the table', () => {
        const balls = rackEightBall(table, 999);
        const result = runShot(
            balls,
            { angle: 0, power: 1, spin: { side: 0, vertical: 0 } },
            table,
        );
        expect(result.steps).toBeLessThan(60_000); // terminated naturally, not the cap
        expect(result.events.length).toBeGreaterThan(0);

        const rackYs = rackEightBall(table, 999)
            .filter((b) => b.number !== 0)
            .map((b) => b.pos.y);
        const spread = Math.max(
            ...result.balls
                .filter((b) => !b.pocketed && b.number !== 0)
                .map((b) => b.pos.y),
        );
        expect(spread).toBeGreaterThan(Math.max(...rackYs)); // balls fanned out

        for (const b of result.balls) {
            if (b.pocketed) continue;
            expect(b.pos.x).toBeGreaterThanOrEqual(-table.pocketRadius);
            expect(b.pos.x).toBeLessThanOrEqual(
                table.width + table.pocketRadius,
            );
            expect(b.pos.y).toBeGreaterThanOrEqual(-table.pocketRadius);
            expect(b.pos.y).toBeLessThanOrEqual(
                table.height + table.pocketRadius,
            );
        }
    });

    it('sinks an object ball lined up with a corner pocket', () => {
        const pocket = { x: table.width, y: table.height };
        const obj = { x: 2.2, y: 1.05 };
        const ux = pocket.x - obj.x;
        const uy = pocket.y - obj.y;
        const uLen = Math.hypot(ux, uy);
        const dir = { x: ux / uLen, y: uy / uLen };
        const cue = cueBall(obj.x - dir.x * 0.28, obj.y - dir.y * 0.28);
        const balls = [cue, objectBall(3, obj.x, obj.y)];

        const result = runShot(
            balls,
            {
                angle: Math.atan2(dir.y, dir.x),
                power: 0.55,
                spin: { side: 0, vertical: 0 },
            },
            table,
        );
        expect(result.pocketed).toContain(3);
        expect(result.scratch).toBe(false);
        expect(result.firstContactNumber).toBe(3);
    });

    it('draw makes the cue recoil while follow carries it forward', () => {
        const setup = (): Ball[] => [
            cueBall(0.5, table.height / 2),
            objectBall(5, 1.0, table.height / 2),
        ];
        const straight = { angle: 0, power: 0.5 };

        const draw = runShot(
            setup(),
            { ...straight, spin: { side: 0, vertical: -1 } },
            table,
        );
        const follow = runShot(
            setup(),
            { ...straight, spin: { side: 0, vertical: 1 } },
            table,
        );

        const drawCue = draw.balls.find((b) => b.number === 0)!;
        const followCue = follow.balls.find((b) => b.number === 0)!;
        // Both contacted the object ball...
        expect(draw.firstContactNumber).toBe(5);
        expect(follow.firstContactNumber).toBe(5);
        // ...but the follow cue ends up further down-table than the draw cue.
        expect(followCue.pos.x).toBeGreaterThan(drawCue.pos.x);
    });
});
