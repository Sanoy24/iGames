# Database Layer

The iGames Framework uses **MongoDB** combined with Mongoose, leveraging atomic operators and `ClientSessions` for strict ACID guarantees across documents.

## Schema Highlights

### `WalletSchema`
Maintains user balances.
- Stores `availableMinor` and `reservedMinor` values (always represented as integers).
- Updated exclusively via atomic `$inc` operations inside `WalletService`.
- Optimistic locks are strictly avoided in favor of direct `$inc` to prevent high-throughput collision retries.

### `LedgerEntrySchema`
Immutable log of all financial movement.
- Driven by `idempotencyKey` index.
- Captures `sourceId` and `sourceType` (e.g., `keno_ticket`, `admin_adjustment`) for strict auditability.

### `PlatformStats`
A materialized view pattern.
- Rather than running heavy `$group` aggregates on `LedgerEntry` when an admin queries stats, we leverage atomic `$inc` updates on a global `PlatformStats` document during the same `ClientSession` that modifies the wallet.
- Ensures O(1) reads for the admin dashboard.

## Transaction Strategy

When settling a Bingo game with 5,000 winners, saving 5,000 separate `session.withTransaction` payloads is inefficient.
Instead, games gather state, invoke `walletService.creditInSession(..., session)`, and push all logic into massive multi-document transactions.

```typescript
const session = await this.connection.startSession();
try {
  await session.withTransaction(async () => {
    // 1. Lock room
    // 2. Perform RNG
    // 3. Batch Wallet Updates
    // 4. Save Audit Logs
  });
} finally {
  await session.endSession();
}
```
