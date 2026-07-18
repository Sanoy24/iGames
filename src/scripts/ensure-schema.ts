/**
 * Idempotent schema sync — a production-safe replacement for TypeORM's
 * `synchronize: true`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `synchronize: true` on a live MySQL database repeatedly tries to drop/recreate
 * secondary indexes (a well-known TypeORM behaviour when a foreign-key column
 * overlaps a composite index, made worse by the non-standard
 * `engine: 'InnoDB ROW_FORMAT=DYNAMIC'` string that MySQL reports back as plain
 * `InnoDB`). That aborts the whole sync with `Duplicate key name '...'` and, as a
 * side effect, leaves brand-new COLUMNS unapplied — which is what produced the
 * cascade of `Unknown column '...'` errors on startup.
 *
 * This tool does only the safe, deterministic subset of what synchronize does:
 *   • creates any brand-new table (its columns + indexes + FKs are created in the
 *     single CREATE TABLE statement), and
 *   • adds any missing COLUMN to an already-existing table.
 * It NEVER touches an existing table's indexes, so it can never churn or collide.
 *
 * HOW IT RUNS
 * -----------
 *   • Automatically at app startup (see src/main.ts) BEFORE Nest connects, unless
 *     `DB_SYNCHRONIZE=true` (then TypeORM handles it) or `DB_SKIP_SCHEMA_SYNC=true`.
 *   • Or on demand:  npm run schema:sync
 * It is idempotent — running it when nothing changed is a no-op.
 *
 * It also WIDENS an existing enum column when the entity added new allowed values
 * (e.g. RngAuditLog.gameType gaining `'pool'`). Widening is a pure `MODIFY COLUMN`
 * to a superset of the live values — it never touches indexes and never drops a
 * value, so it is safe and idempotent. Narrowing (removing a live value) is left
 * to a human and reported.
 *
 * LIMITATION
 * ----------
 * It does not add a NEW index/unique-constraint to an EXISTING table (that is the
 * exact operation that makes synchronize unstable). On the rare occasion an entity
 * gains a new index on an existing table, add it by hand with `CREATE INDEX`.
 */
import 'reflect-metadata';
import { join } from 'path';
import { DataSource, Table } from 'typeorm';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * A standalone DataSource that loads the same entities the app uses. `__dirname`
 * is this module's compiled location (dist/scripts), so `../ ** /*.entity.js`
 * resolves to every compiled entity under dist/. The `{js,ts}` glob also lets it
 * work under ts-node in development.
 */
export function buildSchemaDataSource(): DataSource {
  return new DataSource({
    type: 'mysql',
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    username: required('DB_USERNAME'),
    password: process.env.DB_PASSWORD ?? '',
    database: required('DB_DATABASE'),
    entities: [join(__dirname, '..', '**', '*.entity.{js,ts}')],
    synchronize: false,
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
  });
}

/** Escape a value for use inside a single-quoted MySQL string literal. */
function sqlQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/**
 * Parse a MySQL `COLUMN_TYPE` like `enum('a','b','c''d')` into its allowed values,
 * or null if it is not an enum. MySQL single-quotes each value and doubles any
 * embedded quote (`''` -> `'`).
 */
export function parseEnumType(columnType: string | undefined | null): string[] | null {
  if (!columnType || !/^enum\(/i.test(columnType)) return null;
  const inner = columnType.slice(columnType.indexOf('(') + 1, columnType.lastIndexOf(')'));
  const values: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) values.push(m[1].replace(/''/g, "'"));
  return values;
}

/**
 * Read the live `ENUM('a','b',…)` definition for a column and return its allowed
 * values, or null if the column is not an enum (or does not exist).
 */
async function liveEnumValues(
  queryRunner: import('typeorm').QueryRunner,
  tableName: string,
  columnName: string,
): Promise<string[] | null> {
  const rows: Array<{ COLUMN_TYPE: string }> = await queryRunner.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return parseEnumType(rows[0]?.COLUMN_TYPE);
}

/**
 * Bring the live schema up to date: create missing tables, add missing columns,
 * widen enum columns that gained values. Best-effort per item — a single failing
 * item is reported, not fatal, so one problem never blocks the rest. Returns a
 * summary the caller can act on.
 */
export async function runSchemaSync(
  log: (message: string) => void = (m) => console.log(m),
): Promise<{ createdTables: number; addedColumns: number; widenedEnums: number; failures: string[] }> {
  const dataSource = buildSchemaDataSource();
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  let createdTables = 0;
  let addedColumns = 0;
  let widenedEnums = 0;
  const failures: string[] = [];

  try {
    for (const meta of dataSource.entityMetadatas) {
      const desired = Table.create(meta, dataSource.driver);

      // Brand-new table — create it whole (columns + indexes + FKs in one query).
      if (!(await queryRunner.hasTable(meta.tableName))) {
        try {
          await queryRunner.createTable(desired, true);
          createdTables += 1;
          log(`+ created table   ${meta.tableName}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`create table ${meta.tableName}: ${msg}`);
          log(`! FAILED table    ${meta.tableName} — ${msg}`);
        }
        continue;
      }

      // Existing table — only add columns that are missing. Never touch indexes.
      const existing = await queryRunner.getTable(meta.tableName);
      const have = new Set((existing?.columns ?? []).map((column) => column.name));
      for (const column of desired.columns) {
        if (have.has(column.name)) continue;
        try {
          await queryRunner.addColumn(meta.tableName, column);
          addedColumns += 1;
          log(`+ added column    ${meta.tableName}.${column.name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${meta.tableName}.${column.name}: ${msg}`);
          log(`! FAILED column   ${meta.tableName}.${column.name} — ${msg}`);
        }
      }

      // Widen enum columns that gained values (e.g. gameType += 'pool'). A pure
      // MODIFY COLUMN to the superset — never touches indexes, never drops a value.
      for (const column of desired.columns) {
        if (column.type !== 'enum' || !column.enum || !have.has(column.name)) continue;
        const want = column.enum.map(String);
        const live = await liveEnumValues(queryRunner, meta.tableName, column.name);
        if (!live) continue;
        const liveSet = new Set(live);
        const wantSet = new Set(want);
        const missing = want.filter((v) => !liveSet.has(v));
        if (missing.length === 0) continue; // already a superset — nothing to do
        const removed = live.filter((v) => !wantSet.has(v));
        if (removed.length > 0) {
          // Entity narrows the enum — potentially destructive, leave to a human.
          const note = `${meta.tableName}.${column.name}: enum narrows (would drop ${removed.join(', ')}) — apply manually`;
          failures.push(note);
          log(`! SKIP enum       ${note}`);
          continue;
        }
        const enumSql = want.map(sqlQuote).join(', ');
        const nullSql = column.isNullable ? 'NULL' : 'NOT NULL';
        const defSql =
          column.default === undefined || column.default === null
            ? ''
            : ` DEFAULT ${typeof column.default === 'string' && !/^'.*'$/.test(column.default) ? sqlQuote(column.default) : String(column.default)}`;
        const sql = `ALTER TABLE \`${meta.tableName}\` MODIFY \`${column.name}\` ENUM(${enumSql}) ${nullSql}${defSql}`;
        try {
          await queryRunner.query(sql);
          widenedEnums += 1;
          log(`~ widened enum    ${meta.tableName}.${column.name} += ${missing.join(', ')}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${meta.tableName}.${column.name} widen: ${msg}`);
          log(`! FAILED enum     ${meta.tableName}.${column.name} — ${msg}`);
        }
      }
    }
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }

  log(
    `Schema sync: ${createdTables} table(s) created, ${addedColumns} column(s) added, ${widenedEnums} enum(s) widened.`,
  );
  return { createdTables, addedColumns, widenedEnums, failures };
}

// CLI entrypoint — `npm run schema:sync`.
if (require.main === module) {
  // Load a local .env when present (dev); production supplies env vars directly.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config();
  } catch {
    /* dotenv not installed / not needed */
  }
  runSchemaSync()
    .then(({ failures }) => {
      if (failures.length > 0) {
        console.error(
          `\n${failures.length} item(s) need manual attention (often a NOT NULL column with no default on a non-empty table):`,
        );
        for (const failure of failures) console.error(`  - ${failure}`);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Schema sync failed:', err);
      process.exit(1);
    });
}
