/**
 * Deterministic 8-ball pool physics engine.
 *
 * Pure, dependency-free TypeScript designed to run identically in Node (the
 * authoritative server simulation) and the browser (local prediction for a
 * responsive, comfortable feel). A match is fully described by its rack seed
 * plus the ordered list of shot inputs, so any shot or whole game can be
 * replayed and verified  the engine's anti-cheat and audit foundation.
 */
export * from './vec';
export * from './types';
export * from './table';
export * from './rack';
export * from './simulator';
