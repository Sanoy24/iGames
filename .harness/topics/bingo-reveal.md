# Topic: Bingo Ball Reveal & Play Modes

> Agent topic document (Lecture 4). Loaded when working on Bingo draw presentation,
> the client reveal cadence, or the `line` / `pattern` / `prefilled` (derash) win modes.
> Complements `game-lifecycle.md` (server-side room state machine).

---

## Win Modes (`BingoRoom.winMode`)

The room entity carries a `winMode` enum — `'line' | 'pattern' | 'prefilled'` — plus
`numberRange` (pool size) and `gridSize`. The mode is fixed at room creation and
drives ticket purchase, settlement, and the client layout.

| Mode | Pool (`numberRange`) | Card | Ticket buys | Win tiers |
| --- | --- | --- | --- | --- |
| `line` | 90 | 3×9, 15 numbers | auto-generated spots | `one_line`, `two_lines`, `full_house` |
| `pattern` | configurable | 5×5 pattern card | auto-generated | active `patternPrizes[]` (name + prizeMinor) |
| `prefilled` (**derash**) | configurable | numbered cartela grid (`gridSize`, e.g. 75) | player picks **cartela numbers** | winning patterns; pot split by `houseEdgePct` |

- **Prefilled / derash** is the current default (`winMode` default = `'prefilled'`,
  `gridSize` default = 75). Players buy a *cartela number* (a pre-generated card from
  the `BingoCard` pool) rather than free-picking spots — the purchase DTO accepts
  `cartelaNumbers: number[]`, and `BingoTicket.cartelaNumber` records the choice.
- Built-in patterns are seeded via `npm run seed:bingo-patterns`
  (`scripts/seed-bingo-patterns.ts`). Do not hardcode pattern definitions in services —
  they are DB-backed config (`BingoConfig` winning patterns).
- Derash settlement resolves the winner, appends the winner's last-4 phone digits to
  the settlement summary, and distributes `(100 - houseEdgePct)%` of the pot.

## One-active-game guard

`BingoRoom.activeGuard` is a nullable `tinyint` under a UNIQUE index
(`UQ_bingo_active_game`). It is `1` while a room is `open`/`running` and set to `NULL`
on completion/cancellation. MySQL permits many NULLs but only one non-NULL row, so two
concurrent creators — even across backend instances or when the Redis lock is down —
cannot both open an active room; the second INSERT fails with a duplicate-key error.
**Never remove this guard to "fix" a duplicate-key error** — a stuck non-NULL row means
a room failed to complete; heal the room instead.

---

## Paced Reveal (client)

Server polling (`POLL_INTERVAL_MS = 5s`) can deliver several freshly-drawn balls in one
response. Dumping them on screen at once reads as a jittery burst. The client therefore
paces reveals with a single shared cursor so the "now calling" display, the board, and
every ticket card advance **together, one ball at a time**.

Implemented in [Bingo.tsx](../../frontend/src/pages/Bingo.tsx) (search `revealedCount`):

```
room.drawnNumbers  ──poll──▶  drawnNumbers[]            (authoritative, may jump)
                                    │
                        revealedCount cursor            (advances +1 on a timer)
                                    ▼
revealedNumbers = drawnNumbers.slice(0, revealedCount)  ──▶ board, caller, cards
```

Cadence constants (top of file):

| Constant | Value | Meaning |
| --- | --- | --- |
| `REVEAL_BASE_MS` | 1500 | Steady per-ball pace; each ball gets a full moment. |
| `REVEAL_MIN_MS` | 650 | Only used when far behind — still above the ball animation duration. |
| `REVEAL_CATCHUP_BACKLOG` | 10 | Backlog above this switches from BASE to MIN pace. |

Rules the cursor enforces (do not regress these):

- **Never below the animation duration.** `REVEAL_MIN_MS` is the floor even when
  catching up — a 250ms burst that outruns the animation reads as "rushed".
- **Snap, don't replay, on room switch.** On `room.id` change, `revealedCount` jumps to
  the full `drawnNumbers.length` — a player joining mid-game does not watch a replay.
- **Snap to final on completion/cancel.** When status is `completed`/`cancelled`, reveal
  the full list immediately.
- **Clamp overshoot.** If `revealedCount > total` (a room reset shrank the list), clamp
  back to `total`.
- The reveal `pop` sound fires from the cursor tick, so audio stays in sync with the
  visual reveal. Cards mark cells from `revealedSet`, not from the raw
  `ticket.markedNumbers`, so a number lights up exactly when it's called.

---

## Gotchas

- Cards must read the **paced** `revealedSet`/`revealedNumbers`, never `room.drawnNumbers`
  directly — otherwise cards mark ahead of the caller.
- `game-lifecycle.md` still describes the original 90-ball `line` flow. For `prefilled`
  rooms the pool is `numberRange` (not a fixed 90) and the "tiers" are winning patterns,
  not one/two-line/full-house.
