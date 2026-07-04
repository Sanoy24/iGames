/**
 * The default tenant ("operator zero").
 *
 * Every pre-SaaS row is backfilled to this operator, and it serves as the
 * fallback tenant during the Phase 1 rollout until per-request resolution
 * (JWT / Telegram bot / host) is fully wired in Phase 1d. Fixed UUIDs so the
 * value is deterministic across environments and referenceable from code.
 */
export const OPERATOR_ZERO_ID = '00000000-0000-0000-0000-000000000000';
export const OPERATOR_ZERO_CONFIG_ID = '00000000-0000-0000-0000-000000000001';
export const OPERATOR_ZERO_SLUG = 'default';
