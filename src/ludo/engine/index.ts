/**
 * Pure, dependency-free Ludo rules engine — the single source of truth for
 * board mechanics. Runs identically on the server (authoritative) and the
 * client (optimistic UI / legal-move highlighting); never trust the client's
 * copy for anything that affects a staked outcome.
 */
export * from './types';
export * from './board';
export * from './rules';
