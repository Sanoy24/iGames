import {
  REFERRAL_CODE_LENGTH,
  buildReferralPayload,
  generateReferralCode,
  normalizeReferralCode,
  parseReferralPayload,
} from './referral-code.util';

describe('referral-code.util', () => {
  describe('generateReferralCode', () => {
    it('produces a code of the expected length using only the safe alphabet', () => {
      for (let i = 0; i < 200; i += 1) {
        const code = generateReferralCode();
        expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
        // No confusable characters: O/0, I/1/L, U must never appear.
        expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]+$/);
      }
    });

    it('honours an explicit length', () => {
      expect(generateReferralCode(10)).toHaveLength(10);
    });

    it('does not return the same code every call', () => {
      const codes = new Set(Array.from({ length: 50 }, () => generateReferralCode()));
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe('normalizeReferralCode', () => {
    it('uppercases and strips incidental separators', () => {
      expect(normalizeReferralCode(' abc-234 ')).toBe('ABC234');
      expect(normalizeReferralCode('a_b_c_2_3_4')).toBe('ABC234');
    });

    it('returns null for empty or missing input', () => {
      expect(normalizeReferralCode(undefined)).toBeNull();
      expect(normalizeReferralCode(null)).toBeNull();
      expect(normalizeReferralCode('')).toBeNull();
      expect(normalizeReferralCode('   ')).toBeNull();
    });

    it('rejects anything containing characters outside the alphabet', () => {
      // 0, O, 1, I, L and U are deliberately not in the alphabet.
      expect(normalizeReferralCode('ABC01L')).toBeNull();
      expect(normalizeReferralCode('ABCU23')).toBeNull();
      expect(normalizeReferralCode('abc!23')).toBeNull();
      expect(normalizeReferralCode('<script>')).toBeNull();
    });
  });

  describe('parseReferralPayload', () => {
    it('extracts the code from a namespaced payload', () => {
      expect(parseReferralPayload('ref_ABC234')).toBe('ABC234');
      expect(parseReferralPayload('REF_abc234')).toBe('ABC234');
    });

    it('accepts a bare code for hand-typed or legacy links', () => {
      expect(parseReferralPayload('ABC234')).toBe('ABC234');
    });

    it('returns null for unrelated or malformed payloads', () => {
      expect(parseReferralPayload(undefined)).toBeNull();
      expect(parseReferralPayload('')).toBeNull();
      expect(parseReferralPayload('promo_summer')).toBeNull();
      expect(parseReferralPayload('ref_')).toBeNull();
    });

    it('round-trips with buildReferralPayload', () => {
      const code = generateReferralCode();
      expect(parseReferralPayload(buildReferralPayload(code))).toBe(code);
    });
  });
});
