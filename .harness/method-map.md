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
| Bingo: a logged-in player's own cartelas/tickets vanish on tab switch or reload | The read endpoint (`GET /bingo/current`, `/rooms/:id/state`, `/sync`) has **no guard**, so `request.user` is undefined and the server never returns the caller's tickets — they only lived in client memory | Apply `OptionalJwtAuthGuard` (see D-14). Do NOT hand-roll token parsing in the controller. |
| A guard that `extends JwtAuthGuard` injects `undefined` deps at boot | Subclass without an explicit constructor loses `design:paramtypes` DI metadata | Declare an explicit constructor that calls `super(...)` with the same `@Inject`-decorated params (see `OptionalJwtAuthGuard`) |
| Derash cartela refund rejected ("Sales are closed" / "not found") | Refund is `open`-window + own-active-ticket only | `releaseCartela` allows a refund only while `room.status==='open'` and for the caller's own `active` ticket. This is intended; it's not a bug (see D-20). |
| Derash leaderboard round ends the instant the first line hits / no leaderboard develops | Every place uses the same pattern (e.g. all "Any Line"), so the 1st-place pattern completes immediately | In leaderboard mode set **distinct patterns hardest (1st) → easiest (last)**. The round ends on the 1st-place pattern (see D-18). |
| Derash leaderboard win dialog never shows / room switches too fast | The result-display countdown ran concurrently with the live-win queue | The countdown now starts only after `livePlaceQueue` drains (result-hold effect depends on `livePlaceQueue.length`). Don't revert that gate (see D-22). |
| Called number lights up on the board/cards before it shows in "now calling" | All surfaces read one reveal cursor + the caller has an entrance animation | Board/tickets read the **trailing** `boardCount`/`ticketCount` cursors; now-calling reads `revealedCount`. Cascade order is deliberate (see D-22) — don't collapse them. |

---

## Agents / On-Duty & Deposits

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| "No agent is on duty right now" during real Ethiopian working hours | Old routing read the **server clock** (`new Date().getHours()`), which on a UTC host is 3h behind Ethiopia | Availability is now `isAgentEffectivelyOnDuty` evaluated in Ethiopia time via `src/common/agent-duty.util.ts`. Admin sets an agent's `onDutyMode` and/or working window. Never use a raw `new Date()` hour for agent availability (see D-21). |
| Agent gets "You are off duty right now" completing a withdrawal/deposit | `onDutyMode==='off'`, or `auto` but outside the Ethiopia-time working window | Admin sets the agent **Force On** or fixes their `workDaysOfWeek`/hours. `verifyAgentWorkingHoursAndPermission` gates on effective-on-duty + `agentPermissions`. |
| Two agents both appear on duty / deposits split unexpectedly | `auto` windows overlap, or two agents Force-On | Force-`on` is single-primary (`setAgentOnDutyMode` demotes other `on` to `auto`). `findOnDutyAgent` picks one (forced-on first, else earliest start). Give agents non-overlapping windows or pin one. |
| Editing an agent's shift in the **Shifts** tab has no effect on deposits | `AgentShift` + `workStartHour` schedule are **dormant** — they no longer route | Use Admin → Agents → On-Duty + Working Days. The old shift UI is kept intentionally but unused (see D-21). |

---

## Wallet / Withdrawal Fees

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| `Service fee and commission would consume the entire withdrawal amount` | `withdrawalServiceChargePct + withdrawalCommissionPct >= 100`, so net ≤ 0 | Lower the two percentages so `fee + commission < gross` (see D-19). |
| Super-admin never receives the service fee | `superAdminUserId` unset, or equals the processing agent | Set a designated super-admin in Admin → System Config. Fee still increments `platform_stats` for reporting either way. |

---

## Notifications / Broadcast

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| Notification bell is always empty / "not working" | Backend never emitted the event the client listened for | Notifications are now DB-backed: `NotificationsService.safeCreate()` at the event's hook point + `GET /notifications` load on the client. Add new event types at their hook, not as a client-only listener. |
| A wallet/settlement operation rolled back because of a notification | Notification created **inside** the money transaction | Always `safeCreate()` **post-commit** (after `dataSource.transaction()` resolves). It never throws. |
| Duplicate win notification (two bell entries) | Both client-side `addNotification` and the server win emit fired | Wins are server-emitted only (`notifyRoomWinners`/`notifyDrawWinners`); keep confetti/sound client-side but no client `addNotification`. |
| Bot accounts get win notifications / DB rows | Winner list included bots | Skip users where `user.productMetadata?.botPolicy != null` (see `notify*Winners`). |
| `Nest can't resolve NotificationsService` | Module raises notifications but didn't import `NotificationsModule` | Add `NotificationsModule` to that module's `imports`. Never make `NotificationsModule` import a game/wallet module (one-way direction avoids a DI cycle). |
| Emoji stored as `????` in `broadcast_messages`/`notifications` | Column is `utf8`/`utf8mb3` (3-byte) | Declare `charset:'utf8mb4', collation:'utf8mb4_unicode_ci'` on the column (see D-17). |
| Broadcast image 404s in admin preview (dev) | `/uploads` not proxied | Vite proxies `/uploads` → `localhost:3000`; prod serves it via `useStaticAssets` at the backend origin. |
| A scheduled broadcast sent twice | Two instances/ticks claimed the same row | Claim is an atomic `UPDATE ... SET status='sending' WHERE status='scheduled'` (status guard) under a Redis lock — check both are intact. |

---

## Transaction Filters / Display

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| Wallet "Wins"/"Purchases" filter always shows "No transactions" | Frontend matched invented `entryType` values (`ticket_win`, `ticket_purchase`) | Real ledger enum is `stake \| win \| refund \| adjustment \| bonus \| deposit \| reversal \| withdrawal \| agent_receipt`. Filter: wins=`win`/`bonus`, purchases=`stake`, deposits=`deposit`/`agent_receipt`. |

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
