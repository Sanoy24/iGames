# Wallet Module Constraints

> Knowledge-proximity doc (Lecture 3). Keep this next to the wallet code so it stays visible during edits.

---

## MUST

- **MUST** route every balance change through `WalletService.debitInSession()` or `creditInSession()`. Never write to the `wallet` table directly.
- **MUST** pass an `EntityManager` (from an active `dataSource.transaction()` callback) to `debitInSession` / `creditInSession`. These methods create a `LedgerEntry` row in the same transaction without a shared manager, the ledger write is in a separate transaction and can desync.
- **MUST** supply a unique `idempotencyKey` for every debit and credit. Use a deterministic key tied to the business action (e.g. `keno-ticket-purchase:{ticketId}`, `bingo-settlement:{roomId}:{ticketId}:{tier}`). The key space is `(userId, sourceType, idempotencyKey)` unique-indexed in MySQL.
- **MUST** store all amounts as **integer minor units**. No floats.
- **MUST** pass `entryType: 'stake'` for ticket purchases so wager limits are enforced and platform stats are updated.

## MUST NOT

- **MUST NOT** call `debit` / `credit` (the standalone wrappers) inside an existing transaction they open their own `dataSource.transaction()` which will deadlock or nest incorrectly. Use the `InSession` variants inside transactions.
- **MUST NOT** reuse an idempotency key for a different amount or direction. The service hashes the request payload and will throw `ConflictException` if the hash doesn't match an existing key.
- **MUST NOT** update `wallet.reservedMinor` directly. Reserved balance is not currently used for holds do not add reservation logic without updating both the entity and the ledger pattern.
- **MUST NOT** delete or soft-delete `LedgerEntry` rows. The ledger is append-only and immutable by design.
- **MUST NOT** access the `wallet` table from any module other than `WalletModule` and `LedgerModule`. All other modules call `WalletService`.

## Idempotency Key Conventions

| Operation             | Key format                             |
| --------------------- | -------------------------------------- |
| Keno ticket purchase  | `keno-ticket-purchase:{ticketId}`      |
| Keno win settlement   | `keno-win:{drawId}:{ticketId}`         |
| Bingo ticket purchase | `bingo-ticket-purchase:{ticketId}`     |
| Bingo win settlement  | `bingo-win:{roomId}:{ticketId}:{tier}` |
| Crash bet placement   | `crash-bet:{betId}`                    |
| Crash cashout         | `cashout:{betId}:{cashedOutAtX100}`    |
| Crash abandon refund  | `crash-abandon-refund:{betId}`         |
| Telebirr deposit      | `telebirr-deposit:{receiptId}`         |
| Agent top-up          | `agent-topup:{agentActionLogId}`       |

## Error Semantics

| Error                                           | Cause                                               |
| ----------------------------------------------- | --------------------------------------------------- |
| `NotFoundException`                             | Wallet row missing for userId                       |
| `ConflictException('Insufficient...')`          | `availableMinor < amountMinor` on debit             |
| `ConflictException('Wallet is not active')`     | Wallet status is `locked` or `closed`               |
| `ConflictException('Idempotent...in progress')` | Concurrent request with same key (status = pending) |
| `ConflictException('Request hash mismatch')`    | Key reused with different amount/direction          |
