/**
 * Normalize an Ethiopian phone number to canonical E.164 form: `+2519XXXXXXXX`
 * or `+2517XXXXXXXX`.
 *
 * Accepts the common shapes users and Telegram send:
 *   - `+251912345678`, `251912345678`
 *   - `0912345678`   (national trunk form)
 *   - `912345678`    (bare 9-digit)
 *   - the 7-prefixed variants of all the above
 * plus incidental spaces, dashes, dots, and parentheses.
 *
 * Returns the normalized string, or `null` when the input is not a valid
 * Ethiopian mobile number.
 */
export function normalizeEthiopianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let s = raw.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+$/.test(s)) return null;

  let national: string | null = null;
  if (/^251[79]\d{8}$/.test(s)) national = s.slice(3);      // 251XXXXXXXXX
  else if (/^0[79]\d{8}$/.test(s)) national = s.slice(1);   // 0XXXXXXXXX
  else if (/^[79]\d{8}$/.test(s)) national = s;             // XXXXXXXXX (bare)

  if (!national) return null;
  return `+251${national}`;
}

/** True when `raw` is (or can be normalized to) a valid Ethiopian mobile number. */
export function isValidEthiopianPhone(raw: string | null | undefined): boolean {
  return normalizeEthiopianPhone(raw) !== null;
}
