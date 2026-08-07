import { randomInt } from 'crypto';

/**
 * Alphabet for agent referral codes. Deliberately excludes characters that are
 * easily confused when a code is read aloud, written on paper, or retyped from
 * a screenshot: `O`/`0`, `I`/`1`/`L`, and `U` (misheard as "you"). Uppercase
 * only, so casing never has to be preserved — see `normalizeReferralCode`.
 */
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export const REFERRAL_CODE_LENGTH = 6;

/**
 * A random referral code. Uses `crypto.randomInt` rather than `Math.random`:
 * these codes are handed out publicly and attribute customers to an agent, so
 * they should not be guessable in sequence.
 *
 * Uniqueness is enforced by the unique index on `users.referralCode`, not here —
 * callers retry on a duplicate-key collision (see UsersService).
 */
export function generateReferralCode(length = REFERRAL_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Canonicalize a code as typed/pasted by a player (or arriving as a Telegram
 * `/start` deep-link payload) so lookups are forgiving of case and incidental
 * whitespace/punctuation. Returns null when nothing plausible remains — the
 * caller then treats it as "no referral" rather than a failed lookup.
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const cleaned = raw.trim().toUpperCase().replace(/[\s\-_]/g, '');
  if (!cleaned) return null;

  // Only ever match against our own alphabet — anything else can't be one of
  // our codes, and rejecting early keeps garbage payloads out of the DB query.
  if (!new RegExp(`^[${REFERRAL_CODE_ALPHABET}]+$`).test(cleaned)) return null;

  return cleaned;
}

/**
 * The `/start` deep-link payload prefix. Telegram delivers `?start=<payload>`
 * verbatim, and the player bot may later use other payload kinds, so referral
 * links are namespaced instead of passing a bare code.
 */
const REFERRAL_PAYLOAD_PREFIX = 'ref_';

/** Build the payload half of a referral deep link. */
export function buildReferralPayload(code: string): string {
  return `${REFERRAL_PAYLOAD_PREFIX}${code}`;
}

/**
 * Extract a referral code from a `/start` payload. Accepts both the namespaced
 * `ref_ABC123` form and a bare `ABC123`, so older or hand-typed links keep
 * working. Returns null for any other payload (e.g. a future, unrelated
 * deep-link kind), which callers treat as "not a referral".
 */
export function parseReferralPayload(payload: string | null | undefined): string | null {
  if (!payload) return null;

  const trimmed = payload.trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith(REFERRAL_PAYLOAD_PREFIX)
    ? trimmed.slice(REFERRAL_PAYLOAD_PREFIX.length)
    : trimmed;

  return normalizeReferralCode(withoutPrefix);
}
