/**
 * Pure, dependency-free TypeScript. No NestJS/TypeORM/Node-only imports here —
 * this module must run identically on the server (source of truth) and in the
 * browser (optimistic UI / legal-move highlighting). See src/ludo/engine/index.ts.
 */

export type Color = 'red' | 'green' | 'yellow' | 'blue';

export const ALL_COLORS: Color[] = ['red', 'green', 'yellow', 'blue'];

export type TokenPos =
  | { zone: 'base' }
  | { zone: 'track'; index: number } // 0..51 global
  | { zone: 'homecol'; index: number } // 0..5 within own home column
  | { zone: 'home' }; // finished

export interface Token {
  color: Color;
  tokenIndex: number; // 0..3
  pos: TokenPos;
}

export function tokenId(token: Pick<Token, 'color' | 'tokenIndex'>): string {
  return `${token.color}-${token.tokenIndex}`;
}

export interface RuleConfig {
  exitOnSixOnly: boolean;
  extraTurnOnSix: boolean;
  extraTurnOnCapture: boolean;
  extraTurnOnFinish: boolean;
  blockingEnabled: boolean;
  maxConsecutiveSixes: number;
  perTurnSeconds: number;
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  exitOnSixOnly: true,
  extraTurnOnSix: true,
  extraTurnOnCapture: true,
  extraTurnOnFinish: true,
  blockingEnabled: false,
  maxConsecutiveSixes: 3,
  perTurnSeconds: 20,
};

export type GamePhase = 'awaiting_roll' | 'awaiting_move' | 'finished';

export interface GameState {
  colors: Color[]; // active seats, turn order
  tokens: Token[]; // 4 per active color
  turnColorIndex: number; // index into colors[]
  diceValue: number | null; // last rolled value, null before a roll this turn
  legalTokenIds: string[]; // legal moves for diceValue, [] before roll or on no-move
  consecutiveSixes: number;
  phase: GamePhase;
  winnerColor: Color | null;
  finishOrder: Color[]; // colors that finished all 4 tokens, in order
}

export interface CaptureEvent {
  capturedColor: Color;
  capturedTokenIndex: number;
  atCell: number;
}

export interface RollOutcome {
  state: GameState;
  diceValue: number;
  legalTokenIds: string[];
  turnPassed: boolean; // no legal moves, or three-six forfeit
  forfeitedByThreeSixes: boolean;
}

export interface MoveOutcome {
  state: GameState;
  movedTokenId: string;
  from: TokenPos;
  to: TokenPos;
  capture: CaptureEvent | null;
  finishedToken: boolean; // this token reached home
  wonGame: boolean; // this move completed the mover's 4th token
  extraTurn: boolean;
}

export type ActionResult<T> = { ok: true; result: T } | { ok: false; error: string };
