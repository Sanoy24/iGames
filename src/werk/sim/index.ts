/**
 * Deterministic Werk Flega simulation core.
 *
 * Pure, dependency-free TypeScript that runs identically in Node (the
 * authoritative server settlement) and the browser (live display). A game is
 * fully described by its seed + bot roster + config, so the maze, coins, and the
 * entire bot field are reproducible and verifiable  the anti-cheat foundation.
 */
export * from './rng';
export * from './layout';
export * from './botsim';
