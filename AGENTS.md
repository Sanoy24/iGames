# iGames — Agent Guide

Practical working reference for AI coding agents. Read alongside `CLAUDE.md` (domain rules).

---

## Session Start Protocol

Before writing any code:

1. Read `PROGRESS.md` — current verified state and next actions
2. Check `feature_list.json` — pick the first `not_started` or `in_progress` feature
3. Work on **one feature at a time** (WIP=1). Only advance after the verification command exits 0.
4. If something fails, check `.harness/method-map.md` before modifying code

## Session End Protocol

Before closing:

1. Run the verification command from `feature_list.json` for everything you changed
2. Update `PROGRESS.md` with what changed and what's next
3. Update `feature_list.json` status + evidence fields
4. Complete `.harness/clean-state-checklist.md` (build, tests, no stale artifacts)
5. Add any non-obvious design choices to `DECISIONS.md`

## Definition of Done

A feature is done when — and only when — its verification command from `feature_list.json` exits 0 **and** both of these pass:

```bash
npx tsc --noEmit                                    # backend
cd frontend && npx tsc --noEmit && npm run build    # frontend (if changed)
```

Agent confidence is not a completion signal. The verification command is.

---

## Harness Files

| File | When to read |
| --- | --- |
| `PROGRESS.md` | Every session start and end |
| `feature_list.json` | Every session start — pick next task |
| `DECISIONS.md` | Before making any architectural choice |
| `.harness/method-map.md` | When a bug or build failure occurs |
| `.harness/topics/database-patterns.md` | When touching TypeORM, entities, or transactions |
| `.harness/topics/game-lifecycle.md` | When touching Keno, Bingo, or Crash game flow |
| `.harness/topics/frontend-patterns.md` | When working in `frontend/src/` |
| `src/wallet/CONSTRAINTS.md` | When touching anything that moves money |
| `.harness/clean-state-checklist.md` | Every session end |
| `.harness/evaluator-rubric.md` | Before considering a session complete |

---

## Repository Layout

```text
iGames/
├── src/                  # NestJS backend
│   ├── admin/            # Admin REST endpoints, stats, system config
│   ├── agents/           # Agent withdrawal-processing endpoints
│   ├── auth/             # JWT, Telegram Mini App login, credentials login
│   ├── bingo/            # Bingo rooms, tickets, draw engine, win modes
│   ├── bots/             # Auto-playing Keno/Bingo bots
│   ├── broadcast/        # Admin Telegram broadcast (now/scheduled/recurring, image upload)
│   ├── common/           # Shared pipes, guards, interceptors, decorators
│   ├── crash/            # Crash game rounds, bets, scheduler
│   ├── events/           # Socket.IO gateway (real-time game events + user_{id} room)
│   ├── keno/             # Keno config, draws, tickets, rules, paytable
│   ├── ledger/           # Immutable ledger entries (written inside wallet txns)
│   ├── notifications/    # Durable per-user notifications (bell): table + socket push
│   ├── payments/         # Telebirr receipt ingestion
│   ├── redis/            # RedisLockService (distributed draw lock)
│   ├── rng/              # RNG service with audit logging
│   ├── scheduler/        # Keno/Bingo/Crash cron schedulers
│   ├── telegram/         # Grammy bot, Mini App auth, phone-number handler
│   ├── users/            # User + AuthIdentity entities, profile, agent creation
│   └── wallet/           # Wallet debit/credit, always inside a TypeORM transaction
├── frontend/             # React 19 + Vite + TypeScript Mini App / web client
├── .harness/             # Harness files (topic docs, checklists, rubrics)
├── CLAUDE.md             # Non-negotiable domain rules
└── AGENTS.md             # This file
```

---

## Running the Stack

### Prerequisites

- Node.js 20+
- MySQL 8+ — create the database and set `DB_*` env vars
- Redis: `redis-server`

### Backend

```bash
npm install
npm run start:dev       # :3000, watch mode
npx tsc --noEmit        # type check
npm run test:unit       # unit tests (no DB required)
npm test                # all tests
```

### Frontend

```bash
cd frontend
npm install
npm run dev             # :5173
npx tsc --noEmit        # type check
npm run build           # production build
```

### Dev seed (no Telegram required)

```http
POST /dev/seed/player  { "displayName": "Alice", "initialBalanceMinor": 100000 }
POST /dev/seed/admin   { "displayName": "Dev Admin" }
```

Disabled when `NODE_ENV=production`.

---

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend HTTP port (default 3000) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASS` | MySQL connection |
| `REDIS_URL` | Redis for distributed draw lock and Socket.IO adapter |
| `JWT_ACCESS_SECRET` | Sign access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | Sign refresh tokens (different from access secret) |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | e.g. `15m` / `30d` |
| `TELEGRAM_BOT_TOKEN` | From BotFather |
| `TELEGRAM_MINIAPP_URL` | HTTPS URL of the frontend |
| `AUTH_MODE` | `hybrid` (Telegram + credentials) or `telegram` |
| `TELEBIRR_CREDIT_MINOR_PER_BIRR` | Credits per Birr (e.g. 100) |
| `ALLOWED_ORIGIN` | CORS origin for frontend |

---

## Auth Flows

| User type | Endpoint | Identity |
| --- | --- | --- |
| Player (Telegram) | `POST /auth/telegram/miniapp` | Telegram `initData` |
| Agent / Admin | `POST /auth/credentials` | `{ phoneNumber, password }` |

All flows return `{ accessToken, refreshToken, tokenType, expiresIn, user }`. Refresh via `POST /auth/refresh`.

---

## Money Convention

**All amounts are integer minor units.** Never use floats. 100 minor = 1 Birr.

- Debit/credit only through `WalletService` — never write to the `wallet` row directly
- Every wallet mutation creates an immutable `LedgerEntry` in the same TypeORM transaction
- See `src/wallet/CONSTRAINTS.md` for idempotency key conventions and error semantics

---

## Adding a New Feature — Checklist

1. **Entity** — annotate with `@Entity({ engine: 'InnoDB ROW_FORMAT=DYNAMIC' })`, add to `TypeOrmModule.forFeature([])` in the module and to the root TypeORM config
2. **DTO** — validate all inputs with `class-validator`; add `@ApiTags` + `@ApiOkResponse`
3. **Guard** — protect write endpoints with `JwtAuthGuard` + `RolesGuard`; import `JwtModule.register({})` in the module
4. **Money mutations** — `WalletService.debitInSession` / `creditInSession` inside `dataSource.transaction()`; unique idempotency key per operation
5. **Frontend model** — add to `frontend/src/lib/models.ts`
6. **Frontend API call** — add to `frontend/src/lib/api.ts`
7. **Tests** — add a spec file; add path to `test:unit` in `package.json`
8. **Verify** — `npx tsc --noEmit` (backend) + `cd frontend && npx tsc --noEmit && npm run build`

---

## What NOT to Change Without Being Asked

- No payment gateways, KYC, AML, or compliance flows
- No hardcoded game odds, prices, or prize values — all must be database-backed config rows
- No `Math.random()` for game outcomes — use `RngService`
- No direct `wallet` row writes — always use `WalletService`
- No changes to Keno draw size (20 from 1–80) or Bingo grid spec (3×9, 15 numbers, 1–90)
- No Telegram imports in game/wallet/ledger/rng modules
