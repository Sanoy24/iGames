# Topic: Database Patterns

> Agent topic document (Lecture 4). Loaded when working on anything that touches TypeORM, entities, or transactions.
> Entry point: `AGENTS.md` → Harness Files.

---

## Stack

- **MySQL 8** + **TypeORM 0.3** via `@nestjs/typeorm`
- All entities: `ROW_FORMAT=DYNAMIC` (InnoDB) required to avoid 8126-byte inline row limit
- Transactions are `dataSource.transaction(async (manager) => { ... })`

---

## Transaction Pattern

```typescript
// Game-critical operations use a shared EntityManager
await this.dataSource.transaction(async (manager) => {
    await this.walletService.debitInSession(input, manager);
    await manager.save(KenoTicket, ticketEntity);
    // ledger entry is created inside debitInSession  same manager = same transaction
});
```

**Rules:**

- Pass `manager` to every repo call inside the callback
- Use `manager.getRepository(Entity)` or `manager.save(Entity, obj)` not injected repos
- Never call `walletService.debit()` (own-transaction wrapper) inside an existing transaction
- Pessimistic write locks: `{ lock: { mode: 'pessimistic_write' } }` on `findOne` for row-level locking (used in wallet mutation)

---

## Entity Registration

Every entity must appear in **two places**:

1. `TypeOrmModule.forFeature([Entity])` in its own module
2. The `entities` array in `TypeOrmModule.forRootAsync(...)` in `AppModule` (or `src/config/`)

Missing either causes `Repository not found` at runtime.

---

## Row Format

New entities must include the engine annotation:

```typescript
@Entity({ name: 'my_table', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
```

Existing tables not yet migrated: run `ALTER TABLE my_table ROW_FORMAT=DYNAMIC;` on the production DB.

---

## Select:False Columns

Some columns are hidden by default (e.g. `CrashRound.seed`):

```typescript
@Column({ select: false })
seed: string;
```

To load them: use `QueryBuilder` with `.addSelect('r.seed')`. A plain `findOne` will return `undefined` for that field.

---

## Unique Indexes and Status Guards

Scheduled jobs are protected at two levels:

1. **Unique index** on the natural key (e.g. `(userId, sourceType, idempotencyKey)` on `ledger_entries`)
2. **Status column guard**: read the current status inside the transaction and reject if the expected state doesn't match

```typescript
// Example: draw execution guard
if (draw.status !== 'open')
    throw new ConflictException(`Draw is ${draw.status}`);
draw.status = 'locked';
await manager.save(KenoDraw, draw);
// now safe to proceed  concurrent instances will hit 'locked' and skip
```

---

## BigInt / Minor Units

Monetary columns use a `bigintTransformer` because MySQL BIGINT returns strings:

```typescript
const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0,
};

@Column({ type: 'bigint', transformer: bigintTransformer })
availableMinor: number;
```

Always use `BIGINT` for any amount column. Never use `DECIMAL` or `FLOAT`.

---

## Query Builder Notes

- Use `createQueryBuilder` when you need `addSelect`, `setLock`, joins, or raw aggregation
- `.getRawMany()` returns plain objects with aliased column names map them explicitly
- `.getMany()` returns entity instances use this for normal queries

---

## Migration Approach

TypeORM `synchronize: true` is enabled in development but **not** in production.  
For production schema changes: write raw SQL migration scripts in `scripts/` or use TypeORM migrations.
