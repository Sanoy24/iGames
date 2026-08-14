import {
  canExitBase,
  computeNewPos,
  isBlockedForOthers,
  isSafeCell,
  trackCellsTraversed,
} from './board';
import {
  ActionResult,
  ALL_COLORS,
  Color,
  DEFAULT_RULE_CONFIG,
  GameState,
  MoveOutcome,
  RollOutcome,
  RuleConfig,
  Token,
  TokenPos,
  tokenId,
} from './types';

/** Fresh game state: all tokens in base, first color to move, awaiting first roll. */
export function newGame(colors: Color[] = ALL_COLORS, _config: RuleConfig = DEFAULT_RULE_CONFIG): GameState {
  if (colors.length < 2 || colors.length > 4) {
    throw new Error('Ludo requires 2 to 4 colors');
  }
  if (new Set(colors).size !== colors.length) {
    throw new Error('Ludo colors must be unique');
  }

  const tokens: Token[] = [];
  for (const color of colors) {
    for (let tokenIndex = 0; tokenIndex < 4; tokenIndex += 1) {
      tokens.push({ color, tokenIndex, pos: { zone: 'base' } });
    }
  }

  return {
    colors,
    tokens,
    turnColorIndex: 0,
    diceValue: null,
    legalTokenIds: [],
    consecutiveSixes: 0,
    phase: 'awaiting_roll',
    winnerColor: null,
    finishOrder: [],
  };
}

export function currentColor(state: GameState): Color {
  return state.colors[state.turnColorIndex];
}

/**
 * Every token belonging to `color` that has a legal move for `diceValue`,
 * honouring the blocking config (landing on, or passing through, a two-token
 * block on a non-safe cell is illegal when blockingEnabled).
 */
export function legalMoveTokenIds(state: GameState, color: Color, diceValue: number, config: RuleConfig): string[] {
  const legal: string[] = [];

  for (const token of state.tokens) {
    if (token.color !== color || token.pos.zone === 'home') continue;

    if (token.pos.zone === 'base') {
      if (!canExitBase(diceValue, config)) continue;
      if (config.blockingEnabled && isBlockedForOthers(state.tokens, computeEntryIndex(color), color)) continue;
      legal.push(tokenId(token));
      continue;
    }

    const newPos = computeNewPos(color, token.pos, diceValue, config);
    if (newPos === null) continue;

    if (config.blockingEnabled && token.pos.zone === 'track' && newPos.zone === 'track') {
      const traversed = trackCellsTraversed(color, token.pos.index, diceValue);
      if (traversed.some((cell) => isBlockedForOthers(state.tokens, cell, color))) continue;
    }

    legal.push(tokenId(token));
  }

  return legal;
}

function computeEntryIndex(color: Color): number {
  return ({ red: 0, green: 13, yellow: 26, blue: 39 } as Record<Color, number>)[color];
}

/**
 * Apply a server-generated dice value to the current player's turn. The die
 * value itself must come from outside this pure module (RngService / HMAC
 * commit-reveal) — this function only resolves its consequences.
 */
export function applyRoll(state: GameState, diceValue: number, config: RuleConfig = DEFAULT_RULE_CONFIG): ActionResult<RollOutcome> {
  if (state.phase !== 'awaiting_roll') return { ok: false, error: 'Not awaiting a roll' };
  if (!Number.isInteger(diceValue) || diceValue < 1 || diceValue > 6) {
    return { ok: false, error: 'diceValue must be an integer 1-6' };
  }

  const color = currentColor(state);
  const sixStreak = diceValue === 6 ? state.consecutiveSixes + 1 : 0;

  if (diceValue === 6 && sixStreak >= config.maxConsecutiveSixes) {
    const next = advanceTurn(state);
    return {
      ok: true,
      result: {
        state: next,
        diceValue,
        legalTokenIds: [],
        turnPassed: true,
        forfeitedByThreeSixes: true,
      },
    };
  }

  const legalTokenIds = legalMoveTokenIds(state, color, diceValue, config);

  if (legalTokenIds.length === 0) {
    const next = advanceTurn(state);
    return {
      ok: true,
      result: {
        state: next,
        diceValue,
        legalTokenIds: [],
        turnPassed: true,
        forfeitedByThreeSixes: false,
      },
    };
  }

  const next: GameState = {
    ...state,
    diceValue,
    legalTokenIds,
    consecutiveSixes: sixStreak,
    phase: 'awaiting_move',
  };

  return {
    ok: true,
    result: { state: next, diceValue, legalTokenIds, turnPassed: false, forfeitedByThreeSixes: false },
  };
}

/** Apply the player's chosen token move for the already-rolled dice value. */
export function applyMove(state: GameState, movedTokenId: string, config: RuleConfig = DEFAULT_RULE_CONFIG): ActionResult<MoveOutcome> {
  if (state.phase !== 'awaiting_move' || state.diceValue === null) {
    return { ok: false, error: 'Not awaiting a move' };
  }
  if (!state.legalTokenIds.includes(movedTokenId)) {
    return { ok: false, error: 'Token has no legal move for this roll' };
  }

  const color = currentColor(state);
  const tokenIndex = state.tokens.findIndex((t) => tokenId(t) === movedTokenId);
  const token = state.tokens[tokenIndex];
  const diceValue = state.diceValue;

  const newPos = computeNewPos(color, token.pos, diceValue, config);
  if (newPos === null) {
    return { ok: false, error: 'Move overshoots or is otherwise illegal' };
  }

  const tokens = state.tokens.map((t) => ({ ...t, pos: t.pos }));
  let capture: MoveOutcome['capture'] = null;

  if (newPos.zone === 'track' && !isSafeCell(newPos.index)) {
    const opponents = tokens.filter((t) => t.color !== color && t.pos.zone === 'track' && t.pos.index === newPos.index);
    if (opponents.length === 1) {
      const victim = opponents[0];
      const victimIndex = tokens.findIndex((t) => t.color === victim.color && t.tokenIndex === victim.tokenIndex);
      tokens[victimIndex] = { ...tokens[victimIndex], pos: { zone: 'base' } };
      capture = { capturedColor: victim.color, capturedTokenIndex: victim.tokenIndex, atCell: newPos.index };
    }
  }

  tokens[tokenIndex] = { ...tokens[tokenIndex], pos: newPos };

  const finishedToken = newPos.zone === 'home';
  const wonGame = finishedToken && tokens.filter((t) => t.color === color).every((t) => t.pos.zone === 'home');

  const from: TokenPos = token.pos;

  if (wonGame) {
    const finished: GameState = {
      ...state,
      tokens,
      diceValue: null,
      legalTokenIds: [],
      phase: 'finished',
      winnerColor: color,
      finishOrder: [...state.finishOrder, color],
    };
    return {
      ok: true,
      result: { state: finished, movedTokenId, from, to: newPos, capture, finishedToken, wonGame: true, extraTurn: false },
    };
  }

  const extraTurn =
    (diceValue === 6 && config.extraTurnOnSix) ||
    (capture !== null && config.extraTurnOnCapture) ||
    (finishedToken && config.extraTurnOnFinish);

  const withTokens: GameState = { ...state, tokens };
  const next = extraTurn ? grantExtraTurn(withTokens) : advanceTurn(withTokens);

  return {
    ok: true,
    result: { state: next, movedTokenId, from, to: newPos, capture, finishedToken, wonGame: false, extraTurn },
  };
}

function grantExtraTurn(state: GameState): GameState {
  return { ...state, diceValue: null, legalTokenIds: [], phase: 'awaiting_roll' };
}

function advanceTurn(state: GameState): GameState {
  return {
    ...state,
    turnColorIndex: (state.turnColorIndex + 1) % state.colors.length,
    diceValue: null,
    legalTokenIds: [],
    consecutiveSixes: 0,
    phase: 'awaiting_roll',
  };
}
