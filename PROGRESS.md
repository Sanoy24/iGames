# iGames — Session Progress

> Single source of truth for where the project stands. Read this at the start of every session. Update it before closing.

---

## Current Verified State

**Date**: 2026-06-29  
**Branch**: `migration/mysql`  
**DB**: MySQL 8 + TypeORM (`ROW_FORMAT=DYNAMIC` migration pending on production)  
**Backend build**: `npx tsc --noEmit` — clean  
**Frontend build**: `npm run build` in `frontend/` — ✓ clean  
**Tests**: Unit tests pass (`npm run test:unit`)  
**Deployment**: Backend on PM2, frontend static build on server

### What Is Working (verified this session)

| Area | Status |
| --- | --- |
| Backend — all modules (auth, wallet, ledger, keno, bingo, crash, rng, payments, telegram, admin, events) | Passing |
| Keno — pay-first-then-pick flow, PATCH /keno/tickets/:id/numbers, win/lose modal | Passing |
| Bingo — phase machine (buy/playing/result), auto-join, no lobby, self-healing stuck rooms | Passing |
| Crash — JWT guards, stale round abandonment on bootstrap, RNG fix (min:1) | Passing |
| Admin panel — sidebar layout, visual overhaul, Account tab, Bingo config fields (salesWindow, resultDisplay) | Passing |
| Socket.IO — live counts heartbeat every 10s + on-demand request.counts | Passing |

### Known Issues / Pending

| Issue | Status | Notes |
| --- | --- | --- |
| MySQL ROW_FORMAT=DYNAMIC migration | Pending | Run 25 ALTER TABLE statements on production DB |
| Admin per-tab bespoke layouts | Not started | FE-09 in feature_list.json |
| Profile page stats/history | Not started | FE-10 in feature_list.json |

---

## Session Record

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
