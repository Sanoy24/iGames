import { normalizeEthiopianPhone, isValidEthiopianPhone } from './phone.util';

describe('normalizeEthiopianPhone', () => {
  it('normalizes the common Ethiopian formats to +2519/+2517', () => {
    expect(normalizeEthiopianPhone('0912345678')).toBe('+251912345678');
    expect(normalizeEthiopianPhone('+251912345678')).toBe('+251912345678');
    expect(normalizeEthiopianPhone('251912345678')).toBe('+251912345678');
    expect(normalizeEthiopianPhone('912345678')).toBe('+251912345678');
    expect(normalizeEthiopianPhone('0712345678')).toBe('+251712345678');
  });

  it('tolerates spaces, dashes, dots, and parentheses', () => {
    expect(normalizeEthiopianPhone(' 091-234 5678 ')).toBe('+251912345678');
    expect(normalizeEthiopianPhone('+251 (91) 234.5678')).toBe('+251912345678');
  });

  it('rejects invalid numbers', () => {
    expect(normalizeEthiopianPhone('091234567')).toBeNull();   // too short
    expect(normalizeEthiopianPhone('0812345678')).toBeNull();  // invalid leading digit (8)
    expect(normalizeEthiopianPhone('notaphone')).toBeNull();
    expect(normalizeEthiopianPhone('')).toBeNull();
    expect(normalizeEthiopianPhone(undefined)).toBeNull();
    expect(normalizeEthiopianPhone('+1 415 555 0123')).toBeNull(); // non-Ethiopian
  });

  it('isValidEthiopianPhone mirrors normalize', () => {
    expect(isValidEthiopianPhone('0912345678')).toBe(true);
    expect(isValidEthiopianPhone('123')).toBe(false);
  });
});
