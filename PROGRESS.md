# iGames — Session Progress

> Single source of truth for where the project stands. Read this at the start of every session. Update it before closing.

---

## Current Verified State

**Date**: 2026-07-03  
**Branch**: `migration/mysql`  
**DB**: MySQL 8 + TypeORM (entities now declare `InnoDB ROW_FORMAT=DYNAMIC`; ALTER still needed on pre-existing production tables)  
**Backend build**: `npx tsc --noEmit` — clean  
**Frontend build**: `npm run build` in `frontend/` — ✓ clean  
**Tests**: Unit tests pass (`npm run test:unit`) — expanded coverage for Bingo/Crash/Keno/Wallet  
**Deployment**: Backend on PM2, frontend static build on server

### What Is Working (verified this session)

| Area | Status |
| --- | --- |
| Backend — all modules (auth, wallet, ledger, keno, bingo, crash, rng, payments, telegram, admin, events) | Passing |
| Keno — pay-first-then-pick flow, PATCH /keno/tickets/:id/numbers, win/lose modal | Passing |
| Bingo — win modes line / pattern / prefilled(derash), cartela cards, DB-backed patterns, 75-card grid | Passing |
| Bingo — phase machine (buy/playing/result), auto-join, no lobby, self-healing stuck rooms | Passing |
| Bingo — one-active-game DB guard (`UQ_bingo_active_game`) prevents concurrent rooms | Passing |
| Bingo — paced ball reveal (shared cursor, caller+board+cards in lockstep) | Passing |
| Crash — JWT guards, stale round abandonment on bootstrap, RNG fix (min:1), bet/cashout hardening | Passing |
| Admin panel — sidebar layout, KPI icons + donut, Account tab, Bingo config, bot top-up/delete | Passing |
| Payments — Telebirr receipt preview | Passing |
| Socket.IO — live counts heartbeat every 10s + on-demand request.counts | Passing |

### Known Issues / Pending

| Issue | Status | Notes |
| --- | --- | --- |
| MySQL ROW_FORMAT=DYNAMIC on existing prod tables | Pending | Entities fixed for fresh schemas; run 25 ALTER TABLE on pre-existing DB |
| Admin per-tab bespoke layouts | Not started | FE-09 in feature_list.json |
| Profile page stats/history | Not started | FE-10 in feature_list.json |

---

## Session Record

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
