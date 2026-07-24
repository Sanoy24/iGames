import { IndexLike, parseEnumType, planIndexAdditions } from './ensure-schema';

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

describe('planIndexAdditions', () => {
  const idx = (columnNames: string[], name = '', isUnique = false): IndexLike => ({ name, columnNames, isUnique });

  it('creates an index whose columns are not covered live', () => {
    const { toCreate, advisories } = planIndexAdditions(
      [idx(['locationId'], 'IDX_users_locationId')],
      [{ name: 'PRIMARY', columnNames: ['id'], isUnique: true }],
    );
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].columnNames).toEqual(['locationId']);
    expect(advisories).toEqual([]);
  });

  it('skips when the columns are already indexed, even under a different name', () => {
    // Hand-created under a different name — matched by column set, not name.
    const { toCreate } = planIndexAdditions(
      [idx(['locationId'], 'IDX_generated_hash')],
      [{ name: 'my_custom_idx', columnNames: ['locationId'], isUnique: false }],
    );
    expect(toCreate).toEqual([]);
  });

  it('treats column order as significant', () => {
    const { toCreate } = planIndexAdditions(
      [idx(['a', 'b'], 'IDX_ab')],
      [{ name: 'IDX_ba', columnNames: ['b', 'a'], isUnique: false }],
    );
    expect(toCreate).toHaveLength(1);
  });

  it('advises instead of adding UNIQUE when a non-unique index already covers the columns', () => {
    const { toCreate, advisories } = planIndexAdditions(
      [idx(['email'], 'UQ_users_email', true)],
      [{ name: 'IDX_users_email', columnNames: ['email'], isUnique: false }],
    );
    expect(toCreate).toEqual([]);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatch(/not UNIQUE/);
  });

  it('is satisfied when a matching UNIQUE index already exists', () => {
    const { toCreate, advisories } = planIndexAdditions(
      [idx(['email'], 'UQ_users_email', true)],
      [{ name: 'IDX_users_email', columnNames: ['email'], isUnique: true }],
    );
    expect(toCreate).toEqual([]);
    expect(advisories).toEqual([]);
  });

  it('advises when the index name is taken by a different column set', () => {
    const { toCreate, advisories } = planIndexAdditions(
      [idx(['b'], 'shared_name')],
      [{ name: 'shared_name', columnNames: ['a'], isUnique: false }],
    );
    expect(toCreate).toEqual([]);
    expect(advisories[0]).toMatch(/already used/);
  });

  it('de-duplicates desired indexes that share a column signature', () => {
    // e.g. a column that is both @Index() and unique produces two desired entries.
    const { toCreate } = planIndexAdditions(
      [idx(['token'], 'IDX_token'), idx(['token'], 'UQ_token', true)],
      [],
    );
    expect(toCreate).toHaveLength(1);
  });

  it('adds nothing when everything already exists (idempotent re-run)', () => {
    const { toCreate, advisories } = planIndexAdditions(
      [idx(['locationId'], 'IDX_users_locationId')],
      [{ name: 'IDX_users_locationId', columnNames: ['locationId'], isUnique: false }],
    );
    expect(toCreate).toEqual([]);
    expect(advisories).toEqual([]);
  });
});
