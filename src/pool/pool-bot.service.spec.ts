import { RngService } from '../rng/rng.service';
import { PoolBotService } from './pool-bot.service';
import { standardTable } from './engine/table';
import { runShot } from './engine/simulator';
import { Ball } from './engine/types';
import { GameState } from './rules/rules-types';

const table = standardTable();

function cue(x: number, y: number): Ball {
  return { id: 0, number: 0, kind: 'cue', pos: { x, y }, vel: { x: 0, y: 0 }, spin: { x: 0, y: 0, z: 0 }, pocketed: false };
}
function solid(n: number, x: number, y: number): Ball {
  return { id: n, number: n, kind: 'solid', pos: { x, y }, vel: { x: 0, y: 0 }, spin: { x: 0, y: 0, z: 0 }, pocketed: false };
}
function state(balls: Ball[], over: Partial<GameState> = {}): GameState {
  return { balls, turn: 'B', groups: { A: null, B: null }, tableOpen: true, ballInHand: false, phase: 'play', winner: null, ...over };
}

function makeBot(): PoolBotService {
  const rng = { drawUniqueNumbers: jest.fn().mockResolvedValue({ numbers: [12345] }) } as unknown as RngService;
  return new PoolBotService(rng);
}

describe('PoolBotService', () => {
  it('returns a well-formed shot', async () => {
    const bot = makeBot();
    const s = state([cue(0.6, 0.6), solid(3, 1.4, 0.6)]);
    const shot = await bot.computeShot(s, 'B', 'medium', table);
    expect(Number.isFinite(shot.angle)).toBe(true);
    expect(shot.power).toBeGreaterThan(0);
    expect(shot.power).toBeLessThanOrEqual(1);
    expect(Math.abs(shot.spin.side)).toBeLessThanOrEqual(1);
  });

  it('on hard, sinks a ball lined up with a corner pocket', async () => {
    const bot = makeBot();
    const obj = { x: 2.2, y: 1.05 };
    const pocket = { x: table.width, y: table.height };
    const uLen = Math.hypot(pocket.x - obj.x, pocket.y - obj.y);
    const dir = { x: (pocket.x - obj.x) / uLen, y: (pocket.y - obj.y) / uLen };
    const balls = [cue(obj.x - dir.x * 0.3, obj.y - dir.y * 0.3), solid(3, obj.x, obj.y)];

    const shot = await bot.computeShot(state(balls), 'B', 'hard', table);
    const result = runShot(balls, shot, table);
    expect(result.pocketed).toContain(3);
    expect(result.scratch).toBe(false);
  });

  it('never aims at the 8 first on an open table', async () => {
    const bot = makeBot();
    // Only the cue and the 8 on the table → no legal target → safety, but it must
    // not choose a pot on the 8.
    const balls = [cue(0.6, 0.6), { id: 8, number: 8, kind: 'eight' as const, pos: { x: 1.9, y: 0.6 }, vel: { x: 0, y: 0 }, spin: { x: 0, y: 0, z: 0 }, pocketed: false }, solid(2, 1.2, 0.6)];
    const shot = await bot.computeShot(state(balls), 'B', 'hard', table);
    const result = runShot(balls, shot, table);
    // First contact must not be the 8.
    expect(result.firstContactNumber).not.toBe(8);
  });
});
