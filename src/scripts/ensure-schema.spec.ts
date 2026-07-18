import { parseEnumType } from './ensure-schema';

describe('parseEnumType', () => {
  it('parses a simple enum column type', () => {
    expect(parseEnumType("enum('keno','bingo','crash')")).toEqual(['keno', 'bingo', 'crash']);
  });

  it('parses a single-value enum', () => {
    expect(parseEnumType("enum('only')")).toEqual(['only']);
  });

  it('unescapes doubled single quotes inside values', () => {
    expect(parseEnumType("enum('a''b','c')")).toEqual(["a'b", 'c']);
  });

  it('is case-insensitive on the ENUM keyword', () => {
    expect(parseEnumType("ENUM('x','y')")).toEqual(['x', 'y']);
  });

  it('returns null for non-enum column types', () => {
    expect(parseEnumType('varchar(255)')).toBeNull();
    expect(parseEnumType('int')).toBeNull();
  });

  it('returns null for empty / missing input', () => {
    expect(parseEnumType(undefined)).toBeNull();
    expect(parseEnumType(null)).toBeNull();
    expect(parseEnumType('')).toBeNull();
  });

  it('detects a needed widening (superset check)', () => {
    const live = parseEnumType("enum('keno','bingo','crash')")!;
    const want = ['keno', 'bingo', 'crash', 'pool'];
    const missing = want.filter((v) => !live.includes(v));
    expect(missing).toEqual(['pool']);
  });
});
