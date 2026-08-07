# Session Handoff

> Fill this out at the end of every work session. The next session reads it first before touching any code.

---

## Date / Branch

- Date: 2026-07-07 → 2026-07-08
- Branch: `migration/mysql`
- Duration: multi-feature session

---

## Currently Verified State

```bash
# Commands that PASS right now:
npx tsc --noEmit                                   # backend  clean
npx jest                                           # backend  171/171 pass
cd frontend && npx tsc --noEmit && npm run build   # frontend  clean
```

Passing: [x] Backend tsc [x] Frontend tsc [x] Frontend build [x] Unit tests (171)

New columns auto-create via `synchronize` (no migration): `users.onDutyMode`,
`users.workDaysOfWeek`, `bingo_config.prefilledRankingMode` + 4th/5th place
enable/pct + `prefilledFirst..FifthPatternId`, `bingo_rooms.rankingMode`,
`system_configs.withdrawalCommissionPct` + `superAdminUserId`,
`withdrawals.serviceFeeMinor` + `commissionMinor`.

---

## What Changed This Session

- [x] **Derash winning patterns** added `any_two_lines` / `any_three_lines` pattern types (rules detection via `countCompletedLines`, seeded built-ins, DTO). (BE-18, D-18)
- [x] **Derash up to 5 places, each with its own pattern** config gained 4th/5th enable+pct and `prefilledFirst..FifthPatternId`; settlement resolves per-place patterns. Result overlay reveals winners sequentially + a final standings list. (BE-19, FE-17, D-18)
- [x] **Instant-buy cartelas + tap-to-refund** tap buys one cartela immediately, tap your own again (while `open`) refunds it via `DELETE /bingo/rooms/:id/cartelas/:n` (`releaseCartela`, refund ledger + frees pool card). Pay bar removed. Grid available cells → black tile + muted number. (BE-20, FE-16, D-20)
- [x] **Withdrawal fee split** service fee → **super-admin wallet**, commission → **agent** (two cuts from gross; user nets the rest). Config `withdrawalCommissionPct` + `superAdminUserId`; withdrawal stores `serviceFeeMinor`/`commissionMinor`. Admin config UI + Agent net breakdown. (BE-21, FE-18, D-19)
- [x] **Agent on-duty + working schedule** `User.onDutyMode` (`auto`/`on`/`off`) + `workDaysOfWeek`; deposit routing + the withdrawal gate use **effective on-duty** evaluated in **Ethiopia time** (`src/common/agent-duty.util.ts`). Fixes "No agent on duty" (server-clock timezone bug). Admin Agents: On-Duty selector + coverage banner + Working-Days picker. `AgentShift`/`workStartHour` schedule left **dormant** (no longer routes). (BE-22, FE-18, D-21)
- [x] **Derash leaderboard ranking mode** `rankingMode: race | leaderboard` (config + room snapshot). Leaderboard runs to the 1st-place pattern (or pool exhaustion), then `settleDerashLeaderboard` ranks a queue by hardest tier reached → earliest, assigns ranks by **position** (promotion into empty higher slots). Reuses `awardDerashPlace` + `reconcileDerashPool`. (BE-23, FE-18, D-18)
- [x] **Reveal cascade + staged win** a called number shows in "now calling" FIRST, then the board a beat later, then the tickets (`boardCount`/`ticketCount` trailing cursors). The 5×5 win popup is held behind `NOW_CALLING_HOLD_MS`, and the result-display countdown waits for the live-win queue to drain. (FE-17, D-22)

Commits made: none yet all changes are **uncommitted** in the working tree.

---

## Still Broken / Incomplete

| Item                                               | Why not finished                                  | Next action                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Commit this session's work                         | User hadn't asked to commit yet                   | Branch off `migration/mysql`, commit the batch                                                                       |
| Live end-to-end verification                       | Needs DB + Redis + real rounds/withdrawals/agents | Drive a leaderboard round, a withdrawal (check super-admin + agent credits), and a deposit while an agent is on duty |
| Crash win notifications                            | Still the one game not wired to the bell          | `notificationsService.safeCreate({type:'win'})` at the `crash.bet.cashedout` emit                                    |
| Derash "1st-place / keep-calling" idea (race mode) | Parked by user ("get back to this later")         | Discuss unfilled-share redistribution + min-draws-before-close                                                       |
| ROW_FORMAT=DYNAMIC on pre-existing prod tables     | Prod data task                                    | Run the 25 ALTER TABLE (OPS-02)                                                                                      |

---

## Feature List Updates

Moved to `passing`: BE-18, BE-19, BE-20, BE-21, BE-22, BE-23, FE-16, FE-17, FE-18.

Started (`in_progress`): none.

---

## Next Best Action

> One sentence.

Commit this session's batch (bingo per-place patterns + leaderboard mode + instant-buy refund + fee split + agent on-duty/hours + reveal cascade), then do a live-stack pass on a leaderboard round and a withdrawal to confirm the fee split + agent credits.

---

## Commands Needed Next Session

```bash
# All new schema is additive → auto-creates via synchronize; no migration.
# Deploy: npm install && npm run build && pm2 restart igames-backend  (+ rebuild frontend)
```

---

## Context the Next Session Must Know

- **Agent on-duty is the single signal** (`onDutyMode` + working window). Deposits route to the effectively-on-duty agent; only they can claim/complete withdrawals. **All time math is Ethiopia (+180, no DST)** via `agent-duty.util.ts` never the server clock. `AgentShift` + `workStartHour/End` still exist but are **dormant** (kept on purpose; user may revisit).
- **Withdrawal money now splits three ways from gross**: `serviceFeeMinor` → super-admin wallet, `commissionMinor` → agent (a second `agent_receipt` credit), the remainder (`netAmountMinor`) is the user's payout the agent also custodies. Sum = gross. Guards against fee+commission ≥ gross.
- **Derash `rankingMode`**: `race` (each place locked first-come, per-place pattern) vs `leaderboard` (ranks resolved once at the end by final achievement, promotion by queue position). Snapshotted on the room. For leaderboard, patterns must be set **hardest (1st) → easiest (last)**.
- **Reveal order is deliberately staged**: now-calling → board (`NOW_CALLING_LEAD_MS`) → ticket (`BOARD_TO_TICKET_MS`) → 5×5 win popup (`NOW_CALLING_HOLD_MS`) → summary window (waits for the live queue). Don't collapse these back onto one cursor.
- **Money settlement for leaderboard reuses race helpers** (`awardDerashPlace` + `reconcileDerashPool`) don't fork the payout math.
