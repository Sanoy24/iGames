# iGames — Session Progress

> Single source of truth for where the project stands. Read this at the start of every session. Update it before closing.

---

## Current Verified State

**Date**: 2026-07-08  
**Branch**: `migration/mysql` (this session's work is **uncommitted** in the working tree)  
**DB**: MySQL 8 + TypeORM (entities declare `InnoDB ROW_FORMAT=DYNAMIC`; ALTER still needed on pre-existing production tables). This session added **columns only** (all additive, auto-created via `synchronize`): `users.onDutyMode`/`workDaysOfWeek`, `bingo_config.prefilledRankingMode` + 4th/5th place + `prefilledFirst..FifthPatternId`, `bingo_rooms.rankingMode`, `system_configs.withdrawalCommissionPct`/`superAdminUserId`, `withdrawals.serviceFeeMinor`/`commissionMinor`.  
**Backend build**: `npx tsc --noEmit` — clean  
**Frontend build**: `npm run build` in `frontend/` — ✓ clean  
**Tests**: `npx jest` — **171/171 pass**  
**Deployment**: Backend on PM2 (or cPanel Node), frontend static build on server. New deploy needs: `npm install` (adds `@types/multer`) + a writable, gitignored `uploads/` dir.

### What Is Working (verified this session)

| Area | Status |
| --- | --- |
| Backend — all modules (auth, wallet, ledger, keno, bingo, crash, rng, payments, telegram, admin, events) | Passing |
| Keno — pay-first-then-pick flow, PATCH /keno/tickets/:id/numbers, win/lose modal | Passing |
| Bingo — win modes line / pattern / prefilled(derash), cartela cards, DB-backed patterns, 75-card grid | Passing |
| Bingo — phase machine (buy/playing/result), auto-join, no lobby, self-healing stuck rooms | Passing |
| Bingo — one-active-game DB guard (`UQ_bingo_active_game`) prevents concurrent rooms | Passing |
| Bingo — paced ball reveal (calm ~1.5s cadence, breathing caller, current-ball ring on board) | Passing |
| Bingo — derash win dialog renders the winner's 5×5 for all players (settlementSummary.winnerGrid + fallbacks) | Passing |
| Bingo — logged-in player's own cartelas restore after tab switch/reload (OptionalJwtAuthGuard on read endpoints) | Passing |
| Bingo — derash **up to 5 places, each with its own pattern** (`prefilledFirst..FifthPatternId`); sequential winner reveal + final standings | Passing |
| Bingo — derash **rankingMode: race \| leaderboard** (leaderboard resolves ranks at round end by final achievement, promotion by queue position) | Passing |
| Bingo — `any_two_lines` / `any_three_lines` built-in patterns | Passing |
| Bingo — **instant-buy cartelas + tap-to-refund** (DELETE release endpoint, refund ledger, frees pool card); Pay bar removed; black-tile grid | Passing |
| Bingo — **staged reveal**: now-calling → board → ticket cascade, held 5×5 win popup, result countdown waits for live-win queue | Passing |
| Withdrawals — **service fee → super-admin wallet, commission → agent** (two cuts from gross; DB-config %) | Passing |
| Agents — **admin-controlled on-duty + Ethiopia-time working schedule** (`onDutyMode`, `workDaysOfWeek`); deposit routing + withdrawal gate; fixes "No agent on duty" timezone bug | Passing |
| Crash — JWT guards, stale round abandonment on bootstrap, RNG fix (min:1), bet/cashout hardening | Passing |
| Admin panel — sidebar layout, KPI icons + donut, Account tab, Bingo config, bot top-up/delete | Passing |
| Admin — Telegram Broadcast tab (text/image/buttons, send-now/once/recurring, live TG preview, delivery progress) | Passing |
| Notifications — durable per-user bell (withdrawal/deposit/adjustment + bingo/keno wins), server-backed, socket push | Passing |
| Payments — Telebirr receipt preview | Passing |
| Socket.IO — live counts heartbeat every 10s + on-demand request.counts; `user_{id}` room for wallet + notifications | Passing |

### Known Issues / Pending

| Issue | Status | Notes |
| --- | --- | --- |
| MySQL ROW_FORMAT=DYNAMIC on existing prod tables | Pending | Entities fixed for fresh schemas; run 25 ALTER TABLE on pre-existing DB |
| Admin per-tab bespoke layouts | Not started | FE-09 in feature_list.json |
| Profile page stats/history | Not started | FE-10 in feature_list.json |

---

## Session Record

### Session: 2026-07-07 → 2026-07-08 (derash overhaul + agent duty + fee split)

**Goal**: New winning patterns, 5-place per-place-pattern derash + a leaderboard ranking mode, instant-buy/tap-refund cartelas, a withdrawal service-fee/commission split, an admin-controlled agent on-duty + working-hours system, and a staged end-of-round reveal.

**Completed** (all **uncommitted** in the working tree):

- **New patterns** `any_two_lines` / `any_three_lines` — `countCompletedLines` helper in `bingo-rules.service.ts`, seeded built-ins (auto-seed by name on boot), DTO + `PatternType` widened. (BE-18)
- **Derash 5 places, per-place patterns** — `BingoConfig` gained 4th/5th enable+pct and `prefilledFirst..FifthPatternId`; `BingoPrizeTier` +`4th`/`5th`; settlement resolves each place's own pattern (`resolvePrefilledPlacePattern`). (BE-19)
- **Instant-buy + tap-refund** — `DELETE /bingo/rooms/:id/cartelas/:n` → `releaseCartela` (refund ledger `bingo-cartela-refund:{ticketId}`, frees pool card, `open`-only). Frontend taps buy/refund a single cartela (per-cartela pending guard); Pay bar removed; available cells → black tile + muted number (`#8f9db0`). (BE-20, FE-16)
- **Withdrawal fee split** — `WalletService.completeWithdrawalByAgent` now takes `serviceFeePct` + `commissionPct` + `superAdminUserId`: service fee → super-admin wallet (`platform-service-fee:{id}`), commission → agent (`agent-commission:{id}`), net → agent custody. `system_configs.withdrawalCommissionPct`/`superAdminUserId`; `withdrawals.serviceFeeMinor`/`commissionMinor`. Admin config UI + Agent net breakdown. (BE-21, FE-18, D-19)
- **Agent on-duty + working schedule** — `User.onDutyMode` (`auto`/`on`/`off`) + `workDaysOfWeek`; new `src/common/agent-duty.util.ts` (Ethiopia +180 wall clock, working-window + effective-on-duty). `getActiveAgentDepositInfo` + `verifyAgentWorkingHoursAndPermission` now use effective-on-duty; `PATCH /admin/agents/:id/on-duty`. Admin Agents UI: mode selector + coverage banner + Working-Days picker. `AgentShift`/`workStartHour` left dormant. (BE-22, FE-18, D-21)
- **Derash leaderboard mode** — `rankingMode: race|leaderboard` (config + room snapshot); `progressDerashLeaderboard` (end on 1st-place pattern / pool exhaustion) + `settleDerashLeaderboard` (queue by hardest tier→earliest, ranks by position, reuses `awardDerashPlace`+`reconcileDerashPool`); `claimBingo` no-op in leaderboard mode. Admin Ranking Mode dropdown. (BE-23, FE-18, D-18)
- **Staged reveal** — `boardCount`/`ticketCount` trailing cursors (now-calling → board → ticket); `popupArmed` holds the 5×5 win popup behind `NOW_CALLING_HOLD_MS`; result-display countdown starts only after the live-win queue drains. (FE-17, D-22)

**Concurrent (other-agent) work merged cleanly**: `maxCartelasPerUser`, manual `claimBingo`/auto-claim, `finalizeDerashIfDone`, `reconcileDerashPool` (unfilled-place redistribution), `awardDerashPlace`.

**Verified**: `npx tsc --noEmit` clean; `npx jest` **171/171** (added `any_two/three_lines` rules tests); `frontend` `tsc` + `vite build` clean. Live end-to-end not exercised.

**Next best actions**:

1. **Commit** the batch (branch off `migration/mysql`).
2. Live pass: a leaderboard round (verify sequential reveal + standings + payouts), a withdrawal (super-admin + agent credits), a deposit while an agent is on duty.
3. Still pending: Crash win notifications; the parked derash "keep-calling / 1st-place" race-mode idea; ROW_FORMAT ALTER (OPS-02).

---

### Session: 2026-07-04 → 2026-07-05 (broadcast, notifications, bingo polish + fixes)

**Goal**: Ship an admin Telegram broadcast tool, a durable notification system, and fix the reported Bingo/Wallet UX bugs.

**Completed**:

- **Admin Telegram Broadcast** (`src/broadcast/`, commits 19baa9b, 2848de1): new `broadcast_messages` entity + service + controller + `BroadcastScheduler`. Admin composes text + optional uploaded image + inline URL buttons and sends to **all Telegram-linked users** — now / once (scheduled) / recurring (daily|weekly, Ethiopia +3). Multer upload to `uploads/broadcasts/` served at `/uploads/**`; `TelegramBotService.sendBroadcastMessage` throttles ~25 msg/s, honours 429, **reuses the photo `file_id`** after the first send. Scheduler claims due rows with an atomic `scheduled→sending` status guard (exactly-once, multi-instance safe) + 45-min stale recovery. Frontend: new **Broadcast** admin tab with a live Telegram-style preview + delivery progress. See D-16.
- **Durable notifications / bell** (`src/notifications/`, commits 405d50f, 3c49b64): `notifications` table + service + controller; `GameEventsGateway.emitUserNotification` → `notification.new` on `user_{id}`. Wired post-commit, best-effort to withdrawal settle (all 3 paths), deposit credit (new credits only), admin adjustment, and **server-side bingo/keno win** emit at settlement (`notifyRoomWinners`/`notifyDrawWinners`, aggregated per user, bots skipped). Frontend bell is now **server-backed**: loads on login, socket-live, persists read state, per-type icons; the client-side win `addNotification` was removed to avoid a duplicate. See D-15.
- **OptionalJwtAuthGuard** (commit 2272c8b): fixes a logged-in player's purchased cartelas disappearing on tab switch/reload — `GET /bingo/current` (+ `/state`, `/sync`) had no guard so the server never returned the caller's tickets. New reusable guard populates `request.user` when a token is present, allows anonymous otherwise. Guard spec added (4 cases). See D-14.
- **Bingo live-draw polish** (commits f79a386, 6ea4123): calm constant ~1.5s reveal cadence (no more 250ms bursts), "now calling" uses `mode="wait"` + breathing glow, recent-calls strip keyed by number (stable) with enter animation, current ball ringed on the board. Kept iGames' own visual identity (not the reference app's look).
- **Bingo derash win dialog**: renders the winner's 5×5 card for **all** players via `settlementSummary.winnerGrid` with robust fallbacks + authoritative `winnerMarkedNumbers`.
- **CartelaGrid font** (commits a0cc833, 9d3fa4d): 7px → 11px, `font-black`, tight leading/tracking — bigger/bolder without changing the fixed 10-col grid layout.
- **Wallet transaction filter fix**: filters (Wins/Purchases/Deposits) and labels used non-existent `entryType` values (`ticket_win`/`ticket_purchase`); corrected to the real enum (`win`/`stake`/`deposit`/…). Home Bingo card copy → "Next Bingo starts soon! Buy your card".

**Verified**: `npx nest build` clean; `npx jest` 158/158 (updated wallet/bingo/keno specs for new constructor args); `frontend` `tsc` + `vite build` clean. Live end-to-end (real socket round / withdrawal approval) not exercised — needs DB+Redis.

**Next best actions**:

1. **Crash win notifications** — the one game not yet wired; `crash.bet.cashedout` already emits to `user_{id}`, so add a `win` notification there (~2 lines).
2. Deploy: ensure `uploads/` is writable on the server and run `npm install` (new `@types/multer`).
3. Still pending from before: ROW_FORMAT=DYNAMIC ALTER on pre-existing prod tables; FE-09 admin per-tab layouts; FE-10 profile stats.

---

### Session: 2026-07-03 (bingo payout + flat currency)

**Goal**: Fix the derash winner being underpaid, and collapse the wallet to a flat 1:1 ETB model.

**Completed**:

- **Bingo derash double-fee fix**: `evaluateAndSettleDerash` applied `houseEdgePct` (pool) AND `prefilledFirstPlacePct` (default 80%) — a second 20% cut. Winner was paid `pool*0.8` (e.g. pot 40 → 25 instead of 32). Place percentages are now **weights normalised across enabled places**, so a single 1st place takes the full pool. Extracted pure `computePrefilledPrizeMinor()` + added 4 regression tests (bingo unit suite 34 → 38).
- **Flat 1:1 currency model**: removed all ×100/÷100 currency conversions. Backend: `telebirrCreditMinorPerBirr` default 100→1 (SystemConfig entity + admin.service + verifier fallback); crash-config defaults minBet 100→1, maxBet 500_000→5_000, botBet 500→5; crash min/max messages "credits"→"ETB". Frontend: Crash stake `*100`/`÷100` removed (kept multiplier `X100`), QUICK_STAKES → whole ETB; Admin bot/wallet/agent top-ups `*100` removed; Keno autoplay `*100` removed; Wallet dev top-up `÷100` removed.
- **Currency label → "ETB"** everywhere; fixed corrupted strings `ETBedits`/`Bonus ETBedit`/`Transfer ETBedits`, the `e‑Birr` wallet label, and `E-Money`/`Credits`/`Cr` unit labels across Admin, Wallet, Agent, Leaderboard, Crash.

**Verified**: `npx tsc --noEmit` clean (backend + frontend); `npm run test:unit` 151/151 pass; `frontend npm run build` clean.

**⚠ Follow-up (production data)**: entity defaults only apply to NEW config rows. Existing `system_configs` and `crash_config` rows still hold ×100 values — run the one-time UPDATEs (see handoff) or deposits keep crediting ×100 and Crash rejects sane bets.

---

### Session: 2026-06-30 → 2026-07-03

**Goal**: Introduce prefilled/derash Bingo, harden concurrency, and polish the live draw presentation.

**Completed**:

- Bingo win modes: added `prefilled` (default) alongside `line` and `pattern`. `winMode`, `numberRange`, `gridSize`, `houseEdgePct` on `BingoRoom`
- Bingo derash: cartela-number purchases (`cartelaNumbers[]` DTO, `BingoTicket.cartelaNumber`), DB-backed winning patterns via `npm run seed:bingo-patterns`, pot split by `houseEdgePct`, winner last-4 phone digits in settlement summary
- Bingo card pool: `BingoCard` entity — pre-generated cartela cards, grid size 75
- Concurrency: one-active-game guard `activeGuard` under UNIQUE index `UQ_bingo_active_game`; `findRunningRoomIdsDue` uses DB `NOW()`; auto-create guarded against concurrent rooms
- Bingo reveal: paced reveal with a single `revealedCount` cursor (~1.5s/ball, min 0.65s catch-up); caller, board and cards advance in lockstep; snap on room switch/completion; sound synced to cursor
- Entities: switched to `InnoDB ROW_FORMAT=DYNAMIC` engine declaration (fixes fresh-schema row size)
- Crash: bet/cashout handling + error management hardened
- Payments: Telebirr receipt preview; bots: top-up + delete operations
- Tests: expanded unit coverage for Bingo, Crash, Keno, Wallet services
- Harness: added `.harness/topics/{database-patterns,frontend-patterns,game-lifecycle}.md`, `quality-document.md`, and `harness-creator` skill

**Blockers hit**: None outstanding.

**Next best actions** (in priority order):

1. Deploy: `git pull && npm run build && pm2 restart igames-backend` + rebuild frontend; run `seed:bingo-patterns` on target DB
2. Run MySQL ROW_FORMAT=DYNAMIC ALTER TABLE statements on any pre-existing production tables
3. Admin per-tab bespoke layouts (FE-09) — Players table, Keno draw timeline, etc.

> Note: `.harness/topics/game-lifecycle.md` Bingo section still describes the original
> 90-ball `line` flow. See `.harness/topics/bingo-reveal.md` for the current win modes.

---

### Session: 2026-06-29

**Goal**: Fix backend startup (JwtAuthGuard DI), MySQL row size, bingo stuck rooms, crash RNG, bingo performance overhaul, keno UX, admin panel overhaul.

**Completed**:

- CrashModule: Added `JwtModule.register({})`, `JwtAuthGuard`, `RolesGuard` to providers → backend starts
- MySQL: Provided 25 `ALTER TABLE ... ROW_FORMAT=DYNAMIC` statements
- Bingo scheduler: Self-healing guard replaces ConflictException; rooms complete instead of loop
- Crash RNG: Fixed `min: 1` (was 0); formula `(result.numbers[0] - 1) / 1_000_000`
- Crash bootstrap: `abandonStaleRounds()` refunds active bets and crashes stale non-crashed rounds
- Bingo: 40s sales window, 2s draw interval, 10s result display — all configurable via admin
- Bingo: Phase machine (buy/playing/result), GET /bingo/current, no room lobby
- Keno: Pay-first grid lock, PATCH /keno/tickets/:id/numbers (600ms debounce), win/lose modal, tabbed draws/tickets
- Socket.IO: 10s heartbeat + request.counts on-demand event
- Admin: Sidebar layout, adm-* CSS overhaul, Donut SVG chart, Account tab, Bingo config fields
- Frontend build: Clean ✓

**Blockers hit**: None outstanding.

**Next best actions** (in priority order):

1. Deploy: `git pull && npm run build && pm2 restart igames-backend` + rebuild frontend on server
2. Run MySQL ROW_FORMAT=DYNAMIC ALTER TABLE statements on production
3. Admin per-tab bespoke layouts (FE-09) — Players table, Keno draw timeline, etc.

---

### Session: 2026-05-21 (historical)

Backend declared complete. All modules TypeScript-clean. Frontend phase started.

---

## Quick Start for New Session

```bash
# 1. Check current state
cat PROGRESS.md
cat feature_list.json | python -m json.tool | grep -A3 '"status": "in_progress\|not_started"'

# 2. Verify backend
npx tsc --noEmit

# 3. Verify frontend
cd frontend && npx tsc --noEmit && npm run build

# 4. Pick the first not_started or in_progress feature from feature_list.json
# 5. Work on ONE feature at a time (WIP=1)
# 6. Before closing: update this file + feature_list.json
```
