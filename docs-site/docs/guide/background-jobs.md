# Background Jobs & Schedulers

Schedulers form the heart of the automated gaming loop. Because iGames Framework runs horizontally scaled, CRON jobs run simultaneously on all instances.

## Redis Lock Pattern
To prevent three backend servers from running the same Keno draw at the identical second, we use `RedisLockService`.

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async executeScheduledDraws() {
  if (this.shuttingDown) return;
  
  const lock = await this.lockService.acquireLock(DRAW_LOCK_KEY, 300_000);
  if (!lock) return; // Another instance is already handling it
  
  try {
    // 1. Fetch pending draw
    // 2. Compute numbers
    // 3. Settle winners
  } finally {
    await this.lockService.releaseLock(lock);
  }
}
```

## Active CRONs

### `KenoScheduler` (`@nestjs/schedule`)
- **Interval**: `EVERY_MINUTE`
- **Responsibility**: Takes the currently scheduled Keno draw, locks it, calls `RngService`, and invokes `KenoService.executeScheduledDraw`. Sets up the next draw in the future.

### `BingoScheduler`
- **Interval**: `EVERY_5_SECONDS`
- **Responsibility**: Checks `running` rooms, queries `RngService` for the next ball, saves the new `drawnNumbers` state, evaluates all tickets for `one_line`, `two_lines`, or `full_house` matches, and settles wallet balances.

### `ReconciliationScheduler`
- **Interval**: `EVERY_DAY_AT_MIDNIGHT`
- **Responsibility**: Serves as the ultimate anomaly detection protocol. Sums every `LedgerEntry` for every user globally. If `sum(credit) - sum(debit)` does not perfectly match `wallet.availableMinor + wallet.reservedMinor`, it suspends the user immediately and logs a `[URGENT]` payload.
