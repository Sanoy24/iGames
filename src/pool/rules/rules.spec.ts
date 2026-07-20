import { Ball, ShotEvent, ShotResult } from '../engine/types';
import { standardTable, headSpot } from '../engine/table';
import { GameState, Seat } from './rules-types';
import { ballFamily, ballsRemaining, newGame, resolveShot } from './rules';

const table = standardTable();

/** All 16 balls; any number not in `onTable` is marked pocketed. */
function buildBoard(onTable: number[]): Ball[] {
  const set = new Set(onTable);
  const balls: Ball[] = [];
  for (let n = 0; n <= 15; n++) {
    balls.push({
      id: n,
      number: n,
      kind: n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe',
      pos: { x: 1 + n * 0.05, y: 0.6 },
      vel: { x: 0, y: 0 },
      spin: { x: 0, y: 0, z: 0 },
      pocketed: !set.has(n),
    });
  }
  return balls;
}

function makeResult(over: Partial<ShotResult> & { balls: Ball[] }): ShotResult {
  return {
    events: [],
    pocketed: [],
    scratch: false,
    firstContactNumber: null,
    steps: 100,
    duration: 1,
    ...over,
  };
}

function makeState(over: Partial<GameState>): GameState {
  return {
    balls: buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    turn: 'A',
    groups: { A: null, B: null },
    tableOpen: true,
    ballInHand: false,
    phase: 'play',
    winner: null,
    ...over,
  };
}

const contact = (n: number, t = 0.2): ShotEvent => ({ type: 'ball-ball', t, ballNumber: 0, otherNumber: n });
const rail = (n: number, t = 0.4): ShotEvent => ({ type: 'ball-cushion', t, ballNumber: n });

describe('rules — helpers', () => {
  it('classifies ball families', () => {
    expect(ballFamily(0)).toBe('cue');
    expect(ballFamily(3)).toBe('solids');
    expect(ballFamily(8)).toBe('eight');
    expect(ballFamily(12)).toBe('stripes');
  });
  it('counts remaining group balls', () => {
    const board = buildBoard([0, 1, 2, 9, 8]);
    expect(ballsRemaining(board, 'solids')).toBe(2);
    expect(ballsRemaining(board, 'stripes')).toBe(1);
  });
  it('newGame starts on the break, table open', () => {
    const g = newGame(table, 42, 'B');
    expect(g.phase).toBe('break');
    expect(g.turn).toBe('B');
    expect(g.tableOpen).toBe(true);
    expect(g.balls).toHaveLength(16);
  });
});

describe('rules — the break', () => {
  it('legal break that pockets a ball keeps the breaker on, table open', () => {
    const pre = makeState({ phase: 'break' });
    const board = buildBoard([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]); // solid 1 down
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.fouls).toEqual([]);
    expect(out.turnPassed).toBe(false);
    expect(out.state.tableOpen).toBe(true);
    expect(out.state.phase).toBe('play');
    expect(out.state.groups).toEqual({ A: null, B: null }); // break never assigns groups
  });

  it('legal break by rails with no pot passes the turn', () => {
    const pre = makeState({ phase: 'break' });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const events = [contact(1), rail(1), rail(2), rail(3), rail(9)];
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 1, events }), table);
    expect(out.fouls).toEqual([]);
    expect(out.turnPassed).toBe(true);
    expect(out.state.turn).toBe('B');
  });

  it('scratch on the break is a foul with ball in hand and cue re-spotted', () => {
    const pre = makeState({ phase: 'break' });
    const board = buildBoard([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]); // cue gone
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [0], scratch: true, firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.fouls).toContain('scratch');
    expect(out.state.ballInHand).toBe(true);
    expect(out.state.turn).toBe('B');
    const cue = out.state.balls.find((b) => b.number === 0)!;
    expect(cue.pocketed).toBe(false);
    expect(cue.pos.x).toBeCloseTo(headSpot(table).x, 6);
  });

  it('an illegal break (no pot, too few rails) is a foul', () => {
    const pre = makeState({ phase: 'break' });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 1, events: [contact(1), rail(1)] }), table);
    expect(out.fouls).toContain('illegal-break');
    expect(out.state.ballInHand).toBe(true);
  });

  it('the 8 on the break is re-spotted, not a win', () => {
    const pre = makeState({ phase: 'break' });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]); // 8 pocketed
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [8, 1], firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.gameOver).toBe(false);
    const eight = out.state.balls.find((b) => b.number === 8)!;
    expect(eight.pocketed).toBe(false);
  });
});

describe('rules — open table & group assignment', () => {
  it('pocketing a solid assigns solids to the shooter and continues', () => {
    const pre = makeState({ phase: 'play', tableOpen: true });
    const board = buildBoard([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.assignedGroups).toBe(true);
    expect(out.state.groups).toEqual({ A: 'solids', B: 'stripes' });
    expect(out.turnPassed).toBe(false);
  });

  it('pocketing a stripe assigns stripes to the shooter', () => {
    const pre = makeState({ phase: 'play', tableOpen: true });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [9], firstContactNumber: 9, events: [contact(9)] }), table);
    expect(out.state.groups).toEqual({ A: 'stripes', B: 'solids' });
  });

  it('pocketing one of each keeps the table open but the shooter continues', () => {
    const pre = makeState({ phase: 'play', tableOpen: true });
    const board = buildBoard([0, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1, 9], firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.state.tableOpen).toBe(true);
    expect(out.assignedGroups).toBe(false);
    expect(out.turnPassed).toBe(false);
  });

  it('hitting the 8 first on an open table is a foul', () => {
    const pre = makeState({ phase: 'play', tableOpen: true });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 8, events: [contact(8), rail(8)] }), table);
    expect(out.fouls).toContain('eight-first');
    expect(out.state.ballInHand).toBe(true);
    expect(out.state.tableOpen).toBe(true);
  });
});

describe('rules — assigned play', () => {
  const solidsForA = { A: 'solids' as const, B: 'stripes' as const };

  it('hitting the wrong group first is a foul', () => {
    const pre = makeState({ tableOpen: false, groups: solidsForA });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 9, events: [contact(9), rail(9)] }), table);
    expect(out.fouls).toContain('wrong-group-first');
    expect(out.state.ballInHand).toBe(true);
  });

  it('pocketing your own ball continues the turn', () => {
    const pre = makeState({ tableOpen: false, groups: solidsForA });
    const board = buildBoard([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.fouls).toEqual([]);
    expect(out.turnPassed).toBe(false);
    expect(out.state.turn).toBe('A');
  });

  it('pocketing only the opponent ball passes the turn (no foul)', () => {
    const pre = makeState({ tableOpen: false, groups: solidsForA });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [9], firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.fouls).toEqual([]);
    expect(out.turnPassed).toBe(true);
    expect(out.state.turn).toBe('B');
  });

  it('flags no-rail when nothing is pocketed and no ball reaches a cushion', () => {
    const pre = makeState({ tableOpen: false, groups: solidsForA });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.fouls).toContain('no-rail');
  });

  it('a soft safety that reaches a rail is legal but passes the turn', () => {
    const pre = makeState({ tableOpen: false, groups: solidsForA });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 1, events: [contact(1), rail(1)] }), table);
    expect(out.fouls).toEqual([]);
    expect(out.turnPassed).toBe(true);
  });

  it('missing everything is a no-contact foul', () => {
    const pre = makeState({ tableOpen: false, groups: solidsForA });
    const board = buildBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: null, events: [] }), table);
    expect(out.fouls).toContain('no-contact');
    expect(out.state.ballInHand).toBe(true);
  });

  it('scratching in play is a foul with ball in hand and cue re-spotted', () => {
    const pre = makeState({ tableOpen: false, groups: solidsForA });
    const board = buildBoard([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]); // cue gone
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [0], scratch: true, firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.fouls).toContain('scratch');
    expect(out.state.ballInHand).toBe(true);
    expect(out.state.balls.find((b) => b.number === 0)!.pocketed).toBe(false);
  });
});

describe('rules — the 8 ball', () => {
  it('legally pocketing the 8 after clearing your group wins', () => {
    // A=solids has only the 8 left; pockets it cleanly.
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 9, 10, 11, 12, 13, 14, 15]); // 8 gone
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [8], firstContactNumber: 8, events: [contact(8)] }), table);
    expect(out.gameOver).toBe(true);
    expect(out.winner).toBe('A');
  });

  it('calling the pocket and sinking the 8 there wins', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 9, 10, 11, 12, 13, 14, 15]);
    const pocket8: ShotEvent = { type: 'pocket', t: 0.5, ballNumber: 8, pocketIndex: 2 };
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [8], firstContactNumber: 8, events: [contact(8), pocket8] }), table, 2);
    expect(out.gameOver).toBe(true);
    expect(out.winner).toBe('A');
  });

  it('sinking the 8 in a pocket other than the called one loses', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 9, 10, 11, 12, 13, 14, 15]);
    const pocket8: ShotEvent = { type: 'pocket', t: 0.5, ballNumber: 8, pocketIndex: 5 };
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [8], firstContactNumber: 8, events: [contact(8), pocket8] }), table, 2); // called 2, dropped 5
    expect(out.gameOver).toBe(true);
    expect(out.winner).toBe('B');
    expect(out.reason).toMatch(/wrong pocket/i);
  });

  it('pocketing the 8 early loses the game', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 1, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 1, 9, 10, 11, 12, 13, 14, 15]); // 8 gone, solid 1 still up
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [8], firstContactNumber: 1, events: [contact(1)] }), table);
    expect(out.gameOver).toBe(true);
    expect(out.winner).toBe('B');
  });

  it('scratching while pocketing the 8 loses even if the group was cleared', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([9, 10, 11, 12, 13, 14, 15]); // 8 and cue gone
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [8, 0], scratch: true, firstContactNumber: 8, events: [contact(8)] }), table);
    expect(out.gameOver).toBe(true);
    expect(out.winner).toBe('B');
  });

  it('on the 8 but hitting another ball first is a foul', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 9, events: [contact(9), rail(9)] }), table);
    expect(out.fouls).toContain('wrong-ball-first');
    expect(out.state.ballInHand).toBe(true);
    expect(out.gameOver).toBe(false);
  });
});

describe('rules — frozen balls (§16)', () => {
  // Freeze solid 1 against the bottom rail; solid 2 sits mid-table (not frozen).
  const frozenSetup = () => {
    const balls = buildBoard([0, 1, 2, 8, 9, 10, 11, 12, 13, 14, 15]);
    balls[1].pos = { x: 1.0, y: table.ballRadius }; // touching the rail = frozen
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls });
    const board = balls.map((b) => ({ ...b, pos: { ...b.pos } }));
    return { pre, board };
  };

  it('hitting a frozen ball with nothing else reaching a rail is a foul', () => {
    const { pre, board } = frozenSetup();
    // The only cushion contact is the frozen ball itself, right after the strike.
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 1, events: [contact(1, 0.2), rail(1, 0.22)] }), table);
    expect(out.fouls).toContain('no-rail');
  });

  it('a different (non-frozen) ball reaching a rail satisfies the requirement', () => {
    const { pre, board } = frozenSetup();
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 1, events: [contact(1, 0.2), rail(2, 0.3)] }), table);
    expect(out.fouls).not.toContain('no-rail');
  });

  it('a frozen ball that banks away and returns to a rail counts', () => {
    const { pre, board } = frozenSetup();
    // A late cushion hit (well after contact) = it left the rail and came back.
    const out = resolveShot(pre, makeResult({ balls: board, firstContactNumber: 1, events: [contact(1, 0.2), rail(1, 0.6)] }), table);
    expect(out.fouls).not.toContain('no-rail');
  });
});

describe('rules — strict called shots (§9/§257)', () => {
  const pocket = (ball: number, idx: number): ShotEvent => ({ type: 'pocket', t: 0.5, ballNumber: ball, pocketIndex: idx });

  it('a legal ball in the called pocket continues the turn', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 1, 2, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 2, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1), pocket(1, 3)] }), table, 3, true);
    expect(out.turnPassed).toBe(false);
    expect(out.state.turn).toBe('A');
  });

  it('a ball made off the called pocket is slop — stays down, turn passes', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 1, 2, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 2, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1), pocket(1, 5)] }), table, 3, true); // called 3, dropped 5
    expect(out.turnPassed).toBe(true);
    expect(out.state.turn).toBe('B');
    expect(out.reason).toMatch(/slop/i);
    expect(out.pocketed).toContain(1); // ball remains pocketed
  });

  it('assigns the group only on a called pot (open table)', () => {
    const pre = makeState({ tableOpen: true, groups: { A: null, B: null } });
    const board = buildBoard([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1), pocket(1, 3)] }), table, 3, true);
    expect(out.assignedGroups).toBe(true);
    expect(out.state.groups.A).toBe('solids');
  });

  it('slop on an open table does not assign a group and passes the turn', () => {
    const pre = makeState({ tableOpen: true, groups: { A: null, B: null } });
    const board = buildBoard([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1), pocket(1, 5)] }), table, 3, true); // called 3
    expect(out.assignedGroups).toBe(false);
    expect(out.state.tableOpen).toBe(true);
    expect(out.state.turn).toBe('B');
  });

  it('casual mode ignores the called pocket for regular balls (any pocket continues)', () => {
    const pre = makeState({ tableOpen: false, groups: { A: 'solids', B: 'stripes' }, balls: buildBoard([0, 1, 2, 8, 9, 10, 11, 12, 13, 14, 15]) });
    const board = buildBoard([0, 2, 8, 9, 10, 11, 12, 13, 14, 15]);
    // Not strict: dropping in a different pocket than "called" still continues.
    const out = resolveShot(pre, makeResult({ balls: board, pocketed: [1], firstContactNumber: 1, events: [contact(1), pocket(1, 5)] }), table, 3, false);
    expect(out.turnPassed).toBe(false);
    expect(out.state.turn).toBe('A');
  });
});
