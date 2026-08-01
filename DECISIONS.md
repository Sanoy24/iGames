# iGames — Design Decision Log

> Records non-obvious architectural and domain decisions with reasoning. Prevents agents from re-opening settled choices.
> Format: **Decision** → **Why** → **Consequences / constraints it creates**

---

## Architecture

### D-01: MySQL + TypeORM for backend persistence

**Decided**: 2026-06-29 (migrated from MongoDB)  
**Decision**: Use MySQL 8 with TypeORM. All entities use `ROW_FORMAT=DYNAMIC` (InnoDB) to avoid the 8126-byte inline row limit.  
**Why**: MySQL gives relational integrity for wallet/ledger foreign keys; TypeORM `dataSource.transaction()` provides ACID transactions for wallet+ledger atomicity.  
**Constraint**: Every game-critical operation (ticket purchase, settlement) must run inside `dataSource.transaction(async (manager) => { ... })`. Pass `manager` to every repository call inside the callback. All new entities must be added to `TypeOrmModule.forFeature([...])` in their module AND to the TypeORM root config.

### D-02: Integer minor units for all money values
**Decided**: 2026-05-21  
**Decision**: All balances, stakes, prizes stored as integers (minor units). 100 minor = 1 Birr.  
**Why**: Floating-point arithmetic is not safe for financial ledgers. Ratio is configurable via `TELEBIRR_CREDIT_MINOR_PER_BIRR`.  
**Constraint**: Never use `number` with a decimal for any money-like field. Front-end uses `formatCredits(minor)` from `utils.ts`.

### D-03: Wallet mutations only through WalletService

**Decided**: 2026-05-21  
**Decision**: No direct writes to the `wallet` table anywhere. All debits/credits go through `WalletService.debitInSession()` / `creditInSession()`.  
**Why**: Ensures a `LedgerEntry` row is always created in the same TypeORM transaction. Audit trail is non-negotiable.  
**Constraint**: Always pass the `EntityManager` to wallet calls. Idempotency keys are mandatory on ticket purchase and settlement.

### D-04: RNG service — never Math.random()
**Decided**: 2026-05-21  
**Decision**: All game draws use `RngService`. `Math.random()` is banned for any game outcome.  
**Why**: Provably fair requires auditable, seeded, logged randomness. `RngService` logs algorithm version, inputs, outputs, and a hash.  
**Constraint**: RNG input `min` must be ≥ 1 (validator rejects min=0). For crash point generation: `min: 1, max: 1_000_000`, formula `(result.numbers[0] - 1) / 1_000_000`.

---

## Game Rules

### D-05: Keno — 20 unique numbers from 1–80
**Decided**: 2026-05-21  
**Decision**: Fixed draw size. Not configurable at runtime.  
**Why**: Core Keno rule. Changing requires explicit product decision.

### D-06: Bingo — 90-ball, 3×9 grid, 15 numbers per ticket, 1–90
**Decided**: 2026-05-21  
**Decision**: Standard 90-ball British Bingo rules. Three tiers: one-line, two-line, full-house.  
**Why**: Chosen Bingo variant. Grid dimensions and draw pool are non-negotiable without explicit request.

### D-07: Crash — abandon stale rounds on bootstrap
**Decided**: 2026-06-29  
**Decision**: `onApplicationBootstrap` in CrashScheduler calls `abandonStaleRounds()`. Any round not in `crashed` state gets crashed, active bets refunded.  
**Why**: Server restart would otherwise deadlock the scheduler (it tried to resume a `running` round it couldn't recover). Clean slate on every restart is safer.  
**Constraint**: Crash round refunds use idempotency key `crash-abandon-refund:{betId}`.

---

## API & Security

### D-08: Telegram is optional — backend works without it
**Decided**: 2026-05-21  
**Decision**: `AUTH_MODE=hybrid` supports both credentials and Telegram. No game module imports Telegram SDK.  
**Why**: Backend must be saleable as a standalone product. Telegram is one login provider, not a dependency.  
**Constraint**: Telegram-specific logic stays in `src/telegram/` and `src/auth/`. Game, wallet, ledger, RNG modules must not import Grammy or Telegram types.

### D-09: JWT in every module that uses JwtAuthGuard
**Decided**: 2026-06-29  
**Decision**: Each NestJS module that uses `JwtAuthGuard` or `RolesGuard` must import `JwtModule.register({})` and add those guards to its `providers` array.  
**Why**: NestJS DI is module-scoped. `JwtService` is not globally provided. Pattern established by KenoModule; CrashModule was fixed to match.

---

## Frontend

### D-10: Money in frontend — always minor units through API, display via formatCredits()
**Decided**: 2026-05-21  
**Decision**: Frontend never does arithmetic on credits. API responses are in minor units. `formatCredits(minor)` and `formatCreditsFull(minor)` in `utils.ts` handle display.  
**Why**: Consistent with backend integer convention. Prevents display bugs from float rounding.

### D-11: Bingo — no room lobby, single active room model
**Decided**: 2026-06-29  
**Decision**: `GET /bingo/current` returns the single room a player should join. No room selection UI.  
**Why**: Simplifies UX; one room runs at a time anyway. Priority: running → open → last completed.

### D-12: Keno — pay first, then pick numbers
**Decided**: 2026-06-29  
**Decision**: Number grid is locked until player pays. Payment creates a quick-pick ticket; player then edits numbers via PATCH before draw closes.  
**Why**: Prevents incomplete tickets (player picks numbers then abandons payment). Debounced PATCH (600ms) avoids spamming the API on each click.

### D-13: Admin panel — CSS design system, not per-component styles
**Decided**: 2026-06-29  
**Decision**: All admin UI uses shared `adm-*` CSS classes defined in `App.css`. No inline styles or component-level CSS modules for admin.  
**Why**: One restyle of `App.css` propagates to all 10 admin tabs. Consistent visual language without duplicating styles.

---

## Auth (continued)

### D-14: OptionalJwtAuthGuard for read endpoints that serve both players and spectators
**Decided**: 2026-07-05
**Decision**: `src/auth/guards/optional-jwt-auth.guard.ts` — a guard that **extends** `JwtAuthGuard` and wraps `super.canActivate()` in try/catch, returning `true` on any auth failure. It populates `request.user` when a valid Bearer token is present, else lets the request continue anonymously. Applied to `GET /bingo/current`, `/bingo/rooms/:id/state`, `/bingo/rooms/:id/sync`.
**Why**: Those endpoints read `request.user?.id` to return the caller's own tickets, but had **no guard**, so `request.user` was always undefined and a logged-in player's cartelas never came back from the server — they only survived in client memory and vanished on tab switch/reload. This makes the server authoritative for "my tickets" without blocking anonymous spectators.
**Constraint**: A guard that `extends` another **must declare an explicit constructor** that calls `super(...)` with the same `@Inject`-decorated params — otherwise NestJS loses the DI param metadata and injects `undefined`. When adding a similar mixed-auth endpoint, reuse `OptionalJwtAuthGuard`, don't hand-roll token parsing.

---

## Notifications & Messaging

### D-15: Durable notifications table + socket push (bell); toasts stay transient
**Decided**: 2026-07-05
**Decision**: The bell is backed by a `notifications` table (`src/notifications/`). `NotificationsService.create()` **persists then** pushes live via `GameEventsGateway.emitUserNotification(userId, payload)` → `notification.new` on the `user_{id}` socket room. The frontend store loads the list on login (`GET /notifications`), listens for `notification.new`, and persists read state (`POST /notifications/read`). Transient in-context feedback stays as **toasts** (`addToast`), not notifications.
**Why**: Money events (withdrawal approved/rejected, deposit credited) are asynchronous — the user is usually not watching — so they need delivery-on-next-open, reload-surviving unread counts, and read state. An in-memory-only bell fails exactly there.
**Constraints**:
- Notifications are created **post-commit, best-effort** via `NotificationsService.safeCreate()` (never throws) — a notification failure must never roll back the money operation that triggered it. Hook points: `WalletService.processWithdrawal`/agent settle paths, `PaymentsService.submitTelebirrReceipt` (only on a genuinely new credit, not duplicate submits), `AdminService.adjustUserWallet`.
- **Wins are server-emitted** at settlement (`BingoService.notifyRoomWinners` / `KenoService.notifyDrawWinners`), called once at the completion point (scheduler + admin controller), aggregated per user, **skipping bot accounts** (`user.productMetadata?.botPolicy != null`). The old client-side win `addNotification` was removed to avoid a duplicate; confetti/sound stay for instant feedback.
- Any module that raises notifications imports `NotificationsModule`; direction is one-way (Wallet/Payments/Admin/Bingo/Keno → Notifications → Events) so there is **no DI cycle** — do not make `NotificationsModule` import a game/wallet module.

### D-16: Admin Telegram broadcast — disk images, file_id reuse, DB-guarded scheduler
**Decided**: 2026-07-04
**Decision**: `src/broadcast/` lets an admin send one message (text + optional image + inline URL buttons) to **all Telegram-linked users**, immediately / once at a scheduled time / recurring (daily|weekly). Images upload via multer to `uploads/broadcasts/` (served at `/uploads/**` by `useStaticAssets`), stored by relative path. `TelegramBotService.sendBroadcastMessage` sends serially (~25 msg/s, honours 429 `retry_after`, skips blocked users) and **uploads the photo once then reuses the returned `file_id`** for all remaining recipients. `BroadcastScheduler` (`@Cron` every 30s, Redis-locked) claims due rows with an **atomic status-guarded UPDATE** (`scheduled → sending`) so delivery is exactly-once; a long fan-out runs in the background (lock released immediately) and stale `sending` rows are recovered after 45 min.
**Why**: cPanel gives a persistent disk (no S3 needed); `file_id` reuse makes an 18k-user image broadcast upload the image a single time; the DB status guard + Redis lock make it multi-instance and restart safe.
**Constraints**: Recurring/once wall-clock times are interpreted in a **fixed +180 min (Ethiopia UTC+3) offset** — no DST. Deploy needs `npm install` for the added `@types/multer` (dev) and a writable, gitignored `uploads/` dir.

### D-17: `utf8mb4` on user-facing free-text columns (emoji-safe)
**Decided**: 2026-07-04
**Decision**: Columns storing admin/user free text that may contain 4-byte characters (emoji 💸🎉) declare `charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci'` explicitly (e.g. `broadcast_messages.title/text`, `notifications.title/body`).
**Why**: A plain `utf8`/`utf8mb3` column silently replaces 4-byte characters with `?` at insert time (3-byte scripts like Amharic store fine, which hides the bug). Add this to any new column that holds arbitrary user/admin text.

---

## Derash / Bingo (continued)

### D-18: Derash places — per-place patterns, up to 5 places, and two ranking modes
**Decided**: 2026-07-08
**Decision**: A derash room awards up to **5 places** (`1st..5th`), each with **its own winning pattern** (`BingoConfig.prefilledFirst..FifthPatternId`, falling back to `prefilledWinPatternId` → built-in "Any Line"). New line-count patterns `any_two_lines` / `any_three_lines` (via `BingoRulesService.countCompletedLines`). A room carries `rankingMode` (snapshotted from `BingoConfig.prefilledRankingMode`):
- **`race`** (default, original): each enabled place is an **independent** "first cartela to complete THIS place's pattern" race, awarded incrementally as draws land; the pool is reconciled across FILLED places at the end (`reconcileDerashPool`), so unfilled places don't leak to the house.
- **`leaderboard`**: nobody is paid during play. The round runs until a cartela completes the **1st-place pattern** (or the pool is exhausted / no cards remain), then `settleDerashLeaderboard` builds a queue ordered by **hardest place-pattern reached → earliest to reach it → purchase order** and assigns ranks by **position** (queue #1 → 1st, …). A card can be **promoted into a higher empty slot** than the pattern it completed; each card wins exactly one place.
**Why**: Race is a fast "first to bingo" feel; leaderboard reflects final achievement and lets standings reshuffle (the user's explicit design). Both are DB-config selectable, so neither is lost.
**Constraints**: For leaderboard mode set **distinct patterns hardest (1st) → easiest (last)** — if every place is "Any Line" the round ends on the first single line with no leaderboard. Leaderboard settlement **reuses `awardDerashPlace` + `reconcileDerashPool`** — do not fork the payout math. `claimBingo` (manual "Bingo") is a **no-op in leaderboard mode**. Both modes are snapshotted onto the room at creation so a running room ignores a mid-game config flip.

### D-20: Instant-buy cartelas + tap-to-refund (no Pay button)
**Decided**: 2026-07-08
**Decision**: In derash, tapping an available cartela **buys it immediately** (single-cartela purchase); tapping a cartela you own **refunds it** while the room is `open` via `DELETE /bingo/rooms/:id/cartelas/:cartelaNumber` → `BingoService.releaseCartela` (refund ledger `bingo-cartela-refund:{ticketId}` in one transaction, frees the pool `BingoCard`, decrements `soldTickets`). The client uses a per-cartela pending guard; the Pay bar is gone.
**Why**: A one-tap buy/undo is simpler than select-then-pay; refund-anytime-while-open (the user's choice) is the most forgiving.
**Constraint**: Refund is allowed **only while `status === 'open'`** and only for the caller's own `active` ticket; the idempotency key makes a double-tap safe. Available grid cells render as a **black tile + muted number** (`#8f9db0`) with the group colour kept as a thin accent border — legible on big 200/300 grids.

### D-22: Staged end-of-round reveal (now-calling → board → ticket → win window)
**Decided**: 2026-07-08
**Decision**: The reveal cascades across three trailing cursors so a called number is **seen in "now calling" first**, then marks on the **board** (`NOW_CALLING_LEAD_MS` later), then on the **tickets** (`BOARD_TO_TICKET_MS` later): `revealedCount` (announce, + pop sound) → `boardCount` → `ticketCount`. The per-place 5×5 win popup is held behind `NOW_CALLING_HOLD_MS` (`popupArmed`) so the winning ball is seen before the card pops, and the result-display **countdown only starts once the live-win queue drains** (so a multi-place leaderboard round never burns its whole result window on the live popups).
**Why**: Previously every surface read one cursor, so numbers lit up on the board/cards at the same instant they entered "now calling" — and the caller's entrance animation made it look last. The user wanted a clear now-calling → grid → ticket → window order.
**Constraint**: Each trailing cursor **snaps backwards instantly** (room switch/reset) but lags going forward. Don't collapse the board/ticket back onto `revealedNumbers`. All three delays sit comfortably inside the `REVEAL_BASE_MS` (1.5s) per-ball cadence.

### D-23: Bingo bot identity pool is admin-managed and room-scoped
**Decided**: 2026-08-01
**Decision**: Bingo bot display names come from an admin-managed `bot_names` pool, while each `BingoRoom` persists its own `botIdentityMap` of `{ displayName, phoneSuffix }` per bot user id for that specific game.
**Why**: A shared room-scoped map keeps every bot identity stable throughout the round without making the same visible bot name repeat across games. Admin control lets the pool be expanded, edited, activated, deactivated, or trimmed without code changes.
**Constraints**: Within one room, bot names must be unique and phone suffixes should be unique whenever possible. Bot aliases used in settlement summaries and wallet recent-wins must match what players saw in-game, so write the alias into settlement metadata instead of re-deriving it later.

### D-24: Bingo purchase-phase refunds lock in the final 3 seconds, and bot-only rooms self-cancel
**Decided**: 2026-08-01
**Decision**: Cartela refunds stay enabled during the Bingo buy window until the final 3 seconds, where they are locked both server-side and in the client UI. If the last real player leaves and only bot cartelas remain, the room is cancelled/reset and the bot cartelas are refunded before any draw can start.
**Why**: The 3-second lock removes the last-second race where a room could otherwise flip from a valid buy window into a bot-only start at the same instant. Auto-cancelling bot-only rooms keeps the game from ever resolving a bot-vs-bot or empty round.
**Constraints**: The lock is fixed at 3 seconds for now instead of adding a new bingo config field. Final draw validation must still check `realPlayers >= 1` even if the scheduler or client misses a cancellation tick.

---

## Wallet / Agents (continued)

### D-19: Withdrawal deductions — service fee → super-admin wallet, commission → agent
**Decided**: 2026-07-08
**Decision**: On withdrawal completion, two cuts come out of the **gross**: a **service fee** (`system_configs.withdrawalServiceChargePct`) credited to a **designated super-admin's wallet** (`superAdminUserId`), and a **commission** (`withdrawalCommissionPct`) credited to the **processing agent** as a distinct `agent_receipt` earning. The user nets `gross − serviceFee − commission`; the agent also receives that net as payout custody. `withdrawals` stores `serviceFeeMinor` + `commissionMinor` (and `serviceChargeMinor` = their sum). Ledger keys: `platform-service-fee:{id}`, `agent-commission:{id}`, `agent-receipt:{id}`.
**Why**: The platform (super-admin) and the agent both earn a share of the withdrawal; the super-admin fee lands in a real, auditable wallet instead of only the `platform_stats` counter (which is still incremented for reporting).
**Constraints**: `serviceFee + commission < gross` (else `BadRequestException`). All credits happen inside the same transaction as the reservation settle; total credited (net + commission + serviceFee) = gross. The super-admin credit is skipped if `superAdminUserId` is unset or equals the agent.

### D-21: Agent on-duty is the single signal; working hours are Ethiopia-time
**Decided**: 2026-07-08
**Decision**: An agent's availability is governed by **`User.onDutyMode`** (`auto` | `on` | `off`) plus a per-agent **working window** (`workDaysOfWeek` + existing `workStartHour/Minute/workEndHour/Minute`). **Effective on-duty** = `on`, or (`auto` **and** inside the window). Force-`on` is single-primary (setting one demotes other `on` agents to `auto`). The **deposit destination** (`getActiveAgentDepositInfo`) is the one effectively-on-duty agent (respecting deposit permission), and the **withdrawal/claim gate** (`verifyAgentWorkingHoursAndPermission`) requires effective-on-duty. All time math lives in `src/common/agent-duty.util.ts` and is evaluated in **Ethiopia time (+180 min, no DST)** by shifting the instant then reading its UTC wall clock. Admin sets mode via `PATCH /admin/agents/:id/on-duty`.
**Why**: The old routing read the **server clock** (`new Date().getHours()`), so on a UTC host an Ethiopia 9–21 shift was effectively 12–24 → "No agent is on duty right now" during real working hours. Collapsing to one flag + a fixed-offset schedule removes both the timezone bug and the duplicate `AgentShift`/`workStartHour` gate.
**Constraints**: The `agent_shifts` table + its admin Shift UI and the per-agent `workStartHour/End` window are **retained but dormant** (they no longer route) — the user may revisit; don't delete them. `agentPermissions.{deposit,withdraw}` still apply on top of on-duty. Any new "is this agent available" check must use `isAgentEffectivelyOnDuty` — never a raw `new Date()` hour.
