# Method Map — Failure Patterns → Fixes

> Reference doc (Lecture 3 reference material). Maps common failure patterns in this repo to the artifact or code fix that resolves them.
> When a session fails, find the pattern here before touching code.

---

## Backend Startup Failures

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| `Nest can't resolve dependencies of [Guard]... JwtService` | Module uses `JwtAuthGuard` but didn't import `JwtModule` | Add `JwtModule.register({})` to the module's `imports` and `JwtAuthGuard`, `RolesGuard` to `providers` |
| `Repository not found` for an entity | Entity missing from `TypeOrmModule.forFeature([])` or the root config | Add to both |
| `Row size too large (> 8126)` | InnoDB table in COMPACT row format | `ALTER TABLE my_table ROW_FORMAT=DYNAMIC;` |

---

## Transaction / Wallet Errors

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| `ConflictException: Idempotent wallet mutation is already in progress` | Two concurrent requests hit the same idempotency key before the first completed | Transient — retry is safe. If persistent, check for a stuck `pending` idempotency record. |
| `ConflictException: Request hash mismatch` | Idempotency key reused with different amount or direction | Use a unique key per operation (see `src/wallet/CONSTRAINTS.md`) |
| `ConflictException: Insufficient wallet balance` | Debit amount > `availableMinor` | Check balance before debit, or handle in UI |
| `Wallet not found` | No wallet row for userId | Call `walletService.ensureDefaultWallet(userId)` on user creation |
| Ledger entry not created for a wallet mutation | `debit()`/`credit()` called inside an existing `dataSource.transaction()` | Use `debitInSession(input, manager)` / `creditInSession(input, manager)` instead |

---

## Game-Specific Failures

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| Keno draw runs twice | Redis lock not acquired or released too early | Check `RedisLockService`; the draw status `locked` is the second guard |
| `BingoScheduler: Error drawing next number... All numbers already drawn` | Room stuck in `running` after all balls drawn | Self-healing guard in `drawNextNumber` settles remaining tiers and completes the room |
| `CrashScheduler: Failed to start crash round... RNG range is invalid` | `min: 0` passed to RNG | RNG `min` must be ≥ 1. Use `min: 1, max: 1_000_000` |
| Crash scheduler deadlocks on restart | Stale `running`/`waiting` rounds from previous process | `abandonStaleRounds()` is called on `onApplicationBootstrap` — verify it runs |
| Bingo: online player count shows 0 | Socket gateway doesn't emit on connect | `useSocketConnection` emits `request.counts` on `'connect'` event; gateway handles `@SubscribeMessage('request.counts')` |

---

## RNG

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| `BadRequestException: RNG range is invalid` | `min < 1` or `count > (max - min + 1)` or `max < min` | Check inputs. For crash point: `min:1 max:1_000_000 count:1` |
| `gameType provided without gameReference` | Both must be supplied together | Add `gameReference: draw.id` or omit both |
| `mustInclude contains duplicates` | Passed array has repeated values | Deduplicate before passing |

---

## Frontend Build Failures

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| `Cannot find name 'X'` in TSC | Missing import in page/component | Add import from `lucide-react` or `../lib/models` |
| `Property 'data' does not exist on type 'User[]'` | API wrapper already unwraps `.data` — caller accessed `.data` on the result | Use the result directly, not `.data` |
| Vite build fails but TSC passes | Dynamic import or asset path issue | Run `npm run build` — the error message pinpoints the file and line |

---

## Session Continuity

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| New session re-explores project structure for 15+ min | `PROGRESS.md` not updated at end of last session | Update `PROGRESS.md` before closing every session |
| Agent makes contradictory design choice | `DECISIONS.md` not checked | Read `DECISIONS.md` at start of session before writing any code |
| Feature declared done without running verification | Agent confidence ≠ actual correctness | Run the verification command from `feature_list.json` for every feature before moving status to `passing` |
