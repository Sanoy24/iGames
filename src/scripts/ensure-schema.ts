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

/**
 * Bring the live schema up to date: create missing tables, add missing columns.
 * Best-effort per item — a single failing column is reported, not fatal, so one
 * problem column never blocks the rest. Returns a summary the caller can act on.
 */
export async function runSchemaSync(
  log: (message: string) => void = (m) => console.log(m),
): Promise<{ createdTables: number; addedColumns: number; failures: string[] }> {
  const dataSource = buildSchemaDataSource();
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  let createdTables = 0;
  let addedColumns = 0;
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
    }
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }

  log(`Schema sync: ${createdTables} table(s) created, ${addedColumns} column(s) added.`);
  return { createdTables, addedColumns, failures };
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
