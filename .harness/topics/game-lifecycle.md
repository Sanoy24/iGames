# Topic: Game Lifecycle State Machines

> Agent topic document (Lecture 4). Loaded when working on Keno, Bingo, or Crash game flow.

---

## Keno

```
open → locked → drawn → settled
```

| Transition        | Triggered by                                       | Guard                 |
| ----------------- | -------------------------------------------------- | --------------------- |
| `open → locked`   | Scheduler (EVERY_MINUTE) when `scheduledAt <= now` | `status === 'open'`   |
| `locked → drawn`  | `executeDraw()` RNG draws 20 numbers               | `status === 'locked'` |
| `drawn → settled` | `settleTickets()` all tickets scored and paid      | `status === 'drawn'`  |

**Key rules:**

- Scheduler uses Redis distributed lock + status column transition to prevent duplicate draws
- 20 unique numbers drawn from 1–80 via `RngService` never `Math.random()`
- On bootstrap: if no `open` draw exists and `autoScheduleIntervalMinutes > 0`, create one immediately
- `PATCH /keno/tickets/:id/numbers` is only valid while draw status is `open`

---

## Bingo

```
open → running → settled (per tier) → completed | cancelled
```

| Transition             | Triggered by                                                                         | Guard                  |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| `open → running`       | BingoScheduler when `scheduledStartAt <= now` AND `soldTickets >= minTicketsToStart` | `status === 'open'`    |
| Running → draw ball    | BingoScheduler (EVERY_SECOND), checks `updatedAt` vs `drawIntervalSeconds`           | `status === 'running'` |
| Running → tier settled | Automatic when first ticket completes a tier                                         |                        |
| Running → completed    | After all tiers settled OR all 90 numbers drawn                                      |                        |

**Sales window**: `salesWindowSeconds` (default 40s) from `scheduledStartAt`. Tickets can only be bought while `status === 'open'`.

**Self-healing guard**: If `drawnNumbers.length >= numberRange` and status is still `running`, `drawNextNumber` settles any remaining tiers and marks the room `completed` instead of throwing.

**`GET /bingo/current`** priority: `running` → `open` → last `completed`.

---

## Crash

```
waiting → running → crashed
```

| Transition          | Triggered by                                  | Guard                  |
| ------------------- | --------------------------------------------- | ---------------------- |
| `waiting → running` | CrashScheduler after `waitingDurationSeconds` | `status === 'waiting'` |
| `running → crashed` | Multiplier exceeds crash point                | `status === 'running'` |

**Crash point formula** (all math in ×100 integer space):

```
e = (rngNumber - 1) / 1_000_000   // uniform [0, 1), RNG min=1 max=1_000_000
denominator = e * 100 + houseEdgePct
rawX100 = floor(10_000 / denominator)
crashPointX100 = clamp(rawX100, 100, maxMultiplierX100)
```

**Bootstrap**: `onApplicationBootstrap` calls `abandonStaleRounds()` which crashes any non-crashed round left from a previous process and refunds all active bets with idempotency key `crash-abandon-refund:{betId}`.

**Seed reveal**: `CrashRound.seed` is `select: false` only revealed in `getRecentRounds()` (crashed rounds) using `addSelect('r.seed')`.

---

## RNG Service

All game draws use `RngService.drawUniqueNumbers()`. Never use `Math.random()`.

```typescript
const result = await this.rngService.drawUniqueNumbers({
    min: 1, // MUST be >= 1 (validator rejects 0)
    max: 80,
    count: 20,
    gameType: 'keno',
    gameReference: draw.id, // required when gameType is provided
});
// result.numbers: number[]
// result.auditLogId: string (saved for settlement evidence)
```

---

## Settlement Idempotency

Every settlement credit uses a deterministic idempotency key so safe retries are possible:

| Game           | Key format                             |
| -------------- | -------------------------------------- |
| Keno win       | `keno-win:{drawId}:{ticketId}`         |
| Bingo tier win | `bingo-win:{roomId}:{ticketId}:{tier}` |
| Crash cashout  | `cashout:{betId}:{cashedOutAtX100}`    |

A second call with the same key returns the cached result with `idempotent: true` and does not double-credit.
