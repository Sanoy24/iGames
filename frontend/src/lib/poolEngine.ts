// Single frontend-facing entry to the SHARED 8-ball engine that also runs on the
// server (../src/pool). Importing it here means the browser simulates shots with
// byte-identical physics to the authoritative server result  instant local
// animation, zero drift.
export * from '@pool-engine';
export {
    buildTable,
    buildTuning,
    snapshotFromConfig,
    DEFAULT_PHYSICS,
} from '@pool-physics';
export type { PoolPhysicsSnapshot } from '@pool-physics';
