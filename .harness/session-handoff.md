# Session Handoff

> Fill this out at the end of every work session. The next session reads it first before touching any code.

---

## Date / Branch
- Date: 2026-07-04 → 2026-07-05
- Branch: `migration/mysql`
- Duration: multi-session

---

## Currently Verified State

```bash
# Commands that PASS right now:
npx nest build                                     # backend — clean
npx jest                                           # backend — 158/158 pass
cd frontend && npx tsc --noEmit && npm run build   # frontend — clean
```

Passing: [x] Backend build  [x] Frontend tsc  [x] Frontend build  [x] Unit tests (158)

---

## What Changed This Session

- [x] **Admin Telegram Broadcast** (`src/broadcast/`) — text/image/buttons to all Telegram users; now/once/recurring; multer upload → `/uploads`, `file_id` reuse, throttle, Redis-locked + status-guarded scheduler. New **Broadcast** admin tab with live preview. (BE-15, FE-13, D-16)
- [x] **Durable notifications / bell** (`src/notifications/`) — table + service + controller + `emitUserNotification`; wired to withdrawal/deposit/admin-adjust + **server-side bingo/keno win** emit at settlement (bots skipped, aggregated per user). Frontend bell now server-backed. (BE-16, FE-12, D-15)
- [x] **OptionalJwtAuthGuard** on `GET /bingo/current` + `/state` + `/sync` — fixes a logged-in player's cartelas vanishing on tab switch/reload. (BE-17, D-14)
- [x] **Bingo polish**: calm ~1.5s reveal, breathing caller, current-ball ring, stable recent-calls; derash win dialog renders winner 5×5 for all; CartelaGrid font 7→11px bold. (FE-14)
- [x] **Wallet tx filter + labels** fixed (real `entryType` enum); Home Bingo card copy updated. (FE-15)

Commits made:
```
git log --oneline -6
# 3c49b64 durable user notifications system
# 405d50f notification for wins in Bingo/Keno, Wallet entry types
# 9d3fa4d CartelaGrid font weight/size
# a0cc833 CartelaGrid text size/line height
# 2272c8b OptionalJwtAuthGuard
# 2848de1 broadcast utf8mb4 columns
```

---

## Still Broken / Incomplete

| Item | Why not finished | Next action |
|---|---|---|
| Crash win notifications | Scoped to bingo/keno this session | Add `notificationsService.safeCreate({type:'win'})` where `crash.bet.cashedout` is emitted (already targets `user_{id}`) |
| Live end-to-end verification | Needs DB + Redis + a real settled round / withdrawal approval | Run the stack and observe a withdrawal approval + a bingo win reaching the bell |
| ROW_FORMAT=DYNAMIC on pre-existing prod tables | Prod data task | Run the 25 ALTER TABLE (OPS-02) |

---

## Feature List Updates

Features moved to `passing` this session:
- BE-15 (broadcast), BE-16 (notifications), BE-17 (optional auth guard), FE-12 (bell), FE-13 (broadcast tab), FE-14 (bingo polish), FE-15 (wallet filter)

Features started (moved to `in_progress`):
- none

---

## Next Best Action

> One sentence. What should the very next session do first?

Wire **Crash win notifications** at the `crash.bet.cashedout` emit (the only game not yet covered), then do a live-stack pass to confirm withdrawal + win notifications actually reach the bell.

---

## Commands Needed Next Session

```bash
# Deploy (cPanel/PM2):
#   npm install            # picks up @types/multer (dev)
#   ensure ./uploads is writable (gitignored) for broadcast images
#   npm run build && pm2 restart igames-backend   # + rebuild frontend

# New tables auto-create via synchronize: broadcast_messages, notifications
```

---

## Context the Next Session Must Know

- **Notifications vs toasts**: durable, cross-session events (money, wins) → `NotificationsService` (bell). Transient in-context feedback (purchase ok, errors) → `addToast`. Don't mix them.
- **Notification creation is always post-commit + `safeCreate` (best-effort)** — never inside the money transaction. Module direction is one-way into `NotificationsModule` (no DI cycle) — don't reverse it.
- **Wins are server-emitted only** now; there is intentionally no client-side win `addNotification` (would duplicate the bell entry).
- Broadcast/notification free-text columns are **utf8mb4** on purpose (emoji). Any new user/admin text column must match (D-17).
- All broadcast wall-clock times are **Ethiopia +180 min, no DST**.
