/**
 * Pure, provider-agnostic helpers shared by the Telebirr and M-Pesa deposit
 * verifiers. Kept free of Nest/TypeORM so the security-sensitive matching rules
 * have a single source of truth and can be unit-tested directly.
 */

/** Collapse whitespace, trim, lowercase — for comparing person/agent names. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Does a receipt's (often masked) credited account belong to `agentPhone`?
 * Returns true (match), false (definite mismatch → reject), or null (can't tell,
 * e.g. fully masked → caller falls back to the name match). Ethiopian mobile
 * money masks accounts like `251912***789` / `0912****4321`; we compare the
 * visible trailing digits, and do a full compare when the account is unmasked.
 */
export function accountMatchesPhone(receiptAcc?: string | null, agentPhone?: string | null): boolean | null {
  if (!receiptAcc || !agentPhone) return null;
  // Canonical 9-digit local number (9XXXXXXXX), stripping +251 / 0 prefixes.
  const phoneTail = agentPhone.replace(/\D/g, '').slice(-9);
  if (phoneTail.length < 9) return null;

  const isMasked = /[*xX•·.]/.test(receiptAcc.replace(/^\+?251|^0/, ''));
  const accDigits = receiptAcc.replace(/\D/g, '');

  // Not masked → compare the full local number.
  if (!isMasked && accDigits.length >= 9) {
    return accDigits.slice(-9) === phoneTail;
  }

  // Masked, and the visible+masked digits line up with a 9-digit local number
  // (each mask char stands for exactly one digit, e.g. "251714***707"): compare
  // position-by-position on EVERY visible digit — this confirms the leading digits
  // too, not just the trailing run, which matters when the phone is the only link
  // (withdrawals). Only when the alignment is exact, so we never mis-position.
  const local = maskedLocal(receiptAcc);
  if (local.length === 9) {
    let visible = 0;
    for (let i = 0; i < 9; i++) {
      if (local[i] === '*') continue;
      visible++;
      if (local[i] !== phoneTail[i]) return false;
    }
    if (visible >= 3) return true;
    // else: too little visible to be meaningful — fall through to trailing compare.
  }

  // Fallback: compare the visible trailing run of digits (reliably shown).
  // Require ≥3 to be meaningful.
  const trailing = receiptAcc.match(/(\d+)\D*$/)?.[1] ?? '';
  if (trailing.length >= 3) {
    return phoneTail.endsWith(trailing.slice(-9));
  }
  return null;
}

/**
 * Reduce a (possibly masked) account to its local digits + '*' markers, stripping
 * a leading 251 / 0 prefix and normalising all mask glyphs to '*'. Used only to
 * attempt exact positional alignment against a 9-digit local number.
 */
function maskedLocal(acc: string): string {
  let s = acc.replace(/[^\d*xX•·]/g, '').replace(/[xX•·]/g, '*');
  if (s.startsWith('251')) s = s.slice(3);
  else if (s.startsWith('0')) s = s.slice(1);
  return s;
}

/**
 * Parse a `DD/MM/YYYY HH:mm[:ss]` (or `-` separators, 2- or 4-digit year, with
 * an optional AM/PM) timestamp printed in Ethiopia local time (EAT, UTC+3) into
 * the correct absolute UTC instant. Falls back to native parsing for ISO/other
 * formats. Returns null when it can't be understood.
 */
export function parseEatDate(raw?: string | null): Date | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = trimmed.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/,
  );
  if (m) {
    let [, dd, mm, yyyy, hh = '0', min = '0', ss = '0', ampm] = m;
    let year = Number(yyyy);
    if (year < 100) year += 2000; // 2-digit year → 20xx
    let hour = Number(hh);
    if (ampm) {
      const isPm = /p/i.test(ampm);
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
    }
    const utcMs = Date.UTC(year, Number(mm) - 1, Number(dd), hour, Number(min), Number(ss)) - 3 * 60 * 60 * 1000;
    if (!Number.isNaN(utcMs)) return new Date(utcMs);
  }
  const native = new Date(trimmed);
  return Number.isNaN(native.getTime()) ? null : native;
}

/**
 * Freshness check against a max age. Returns a verdict the caller turns into a
 * specific error message: `too_old`, `future`, or `ok`. A small negative
 * tolerance (5 min) absorbs clock skew between the phone and the server.
 */
export function checkFreshness(
  txDate: Date,
  now: Date = new Date(),
  maxAgeMs = 30 * 60 * 1000,
): 'ok' | 'too_old' | 'future' {
  const diffMs = now.getTime() - txDate.getTime();
  if (diffMs > maxAgeMs) return 'too_old';
  if (diffMs < -5 * 60 * 1000) return 'future';
  return 'ok';
}
