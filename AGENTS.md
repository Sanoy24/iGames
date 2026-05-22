# iGames — Agent Guide

Practical working reference for AI coding agents. Read alongside `CLAUDE.md` (domain rules) — this file covers how to navigate, run, test, and change the codebase.

---

## Repository Layout

```text
iGames/
├── src/                  # NestJS backend
│   ├── admin/            # Admin REST endpoints, stats, system config
│   ├── agents/           # Agent withdrawal-processing endpoints
│   ├── auth/             # JWT, Telegram Mini App login, credentials login
│   ├── bingo/            # 90-ball Bingo rooms, tickets, draw engine
│   ├── bots/             # Auto-playing Keno bots
│   ├── common/           # Shared pipes, guards, interceptors, decorators
│   ├── config/           # NestJS ConfigModule setup
│   ├── dev/              # Dev-only seed endpoints (disabled in production)
│   ├── events/           # Socket.IO gateway (real-time game events)
│   ├── health/           # /health endpoint (Terminus)
│   ├── keno/             # Keno config, draws, tickets, rules, paytable
│   ├── ledger/           # Immutable ledger entries (written inside wallet txns)
│   ├── payments/         # Telebirr receipt ingestion
│   ├── redis/            # RedisLockService (distributed draw lock)
│   ├── rng/              # RNG service with audit logging
│   ├── scheduler/        # Keno cron scheduler (every minute)
│   ├── telegram/         # Grammy bot, Mini App auth, phone-number handler
│   ├── users/            # User + AuthIdentity schemas, profile, agent creation
│   └── wallet/           # Wallet debit/credit, always in MongoDB transactions
├── frontend/             # React 19 + Vite + TypeScript Mini App / web client
│   └── src/
│       ├── components/   # BottomNav, WalletBar, Toasts, CredentialsLogin
│       ├── hooks/        # useSocketConnection
│       ├── lib/          # api.ts, models.ts, utils.ts, audio.ts, navigation.ts
│       ├── pages/        # Home, Games, Keno, Bingo, Wallet, Profile, Admin, Agent
│       └── store/        # Zustand store (useStore.ts)
├── .env                  # Local env (never commit secrets)
├── CLAUDE.md             # Non-negotiable domain rules
└── AGENTS.md             # This file
```

---

## Running the Stack

### Prerequisites

- Node.js 20+
- MongoDB 6+ with replica set (required for transactions): `mongod --replSet rs0 --port 27018`
- Redis: `redis-server`

### Backend

```bash
# Install
npm install

# Dev (watch mode)
npm run start:dev          # listens on :3000

# Type check
npx tsc --noEmit

# Unit tests (game math, no DB required)
npm run test:unit

# All tests
npm test
```

### Frontend

```bash
cd frontend
npm install

# Dev server
npm run dev                # listens on :5173

# Type check
npx tsc --noEmit

# Build
npm run build
```

### Telegram Mini App (local dev)

1. Start both servers above
2. Run `ngrok http 5173` and copy the HTTPS URL
3. Set `TELEGRAM_MINIAPP_URL=<ngrok-url>` in `.env`
4. Restart the backend — `onModuleInit` in `TelegramModule` calls `setChatMenuButton` with the new URL

### Dev seed (no Telegram needed)

```http
POST /dev/seed/player  { "displayName": "Alice", "initialBalanceMinor": 100000 }
POST /dev/seed/admin   { "displayName": "Dev Admin" }
```

These endpoints are disabled when `NODE_ENV=production`.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | Backend HTTP port (default 3000) |
| `MONGODB_URI` | MongoDB connection with `replicaSet=rs0` (transactions require this) |
| `REDIS_URL` | Redis for distributed draw lock and Socket.IO adapter |
| `JWT_ACCESS_SECRET` | Sign access tokens (min 32 chars random) |
| `JWT_REFRESH_SECRET` | Sign refresh tokens (different from access secret) |
| `JWT_ACCESS_TTL` | e.g. `15m` |
| `JWT_REFRESH_TTL` | e.g. `30d` |
| `TELEGRAM_BOT_TOKEN` | From BotFather |
| `TELEGRAM_MINIAPP_URL` | HTTPS URL of the frontend (ngrok in dev) |
| `AUTH_MODE` | `hybrid` = both Telegram and credentials; `telegram` = Telegram only |
| `TELEBIRR_CREDIT_MINOR_PER_BIRR` | How many credits 1 Birr buys (e.g. 100) |
| `ALLOWED_ORIGIN` | CORS allowed origin for the frontend |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_MAX_REQUESTS` | Global rate-limit window |

---

## Auth Flows

| User type | Login endpoint | Identity |
|---|---|---|
| Player (Telegram) | `POST /auth/telegram/miniapp` | Telegram `initData` |
| Agent / Admin | `POST /auth/credentials` | `{ phoneNumber, password }` |
| Dev seed | `POST /dev/seed/player` or `/dev/seed/admin` | auto-creates user |

All flows return `{ accessToken, refreshToken, tokenType, expiresIn, user }`.

Access tokens expire in 15 m; use `POST /auth/refresh` with the refresh token.

Agents are created by admins via `POST /admin/agents` (phone number + display name + password). Password is hashed with Argon2id; phone stored as `providerUserId` on the `password` AuthIdentity.

---

## Money Convention

**All amounts are integer minor units (credits).** Never use floats.

- 100 minor = 1 Birr (configurable via `TELEBIRR_CREDIT_MINOR_PER_BIRR`)
- Always debit/credit through `WalletService`, never write to the Wallet document directly
- Every wallet mutation creates an immutable `LedgerEntry` in the same MongoDB transaction
- Idempotency keys prevent double debits/credits — always pass them for ticket purchases and settlements

---

## Key Backend Patterns

### Wallet + Ledger (always together)

```typescript
await walletService.debitInSession({ userId, amountMinor, entryType, sourceType, sourceId, idempotencyKey, metadata }, session);
await walletService.creditInSession({ ... }, session);
```

Both methods create a ledger entry inside the provided MongoDB session.

### MongoDB Transactions

Game-critical operations (ticket purchase, draw execution, settlement) run inside `session.withTransaction(async () => { ... })`. Always pass `{ session }` to every Mongoose call inside the callback.

### Distributed Draw Lock

```typescript
const lock = await lockService.acquireLock('igames:keno:draw-lock', 300_000);
if (!lock) return; // another instance has it
try { ... } finally { await lockService.releaseLock(lock); }
```

The lock prevents duplicate execution when multiple backend instances run behind a load balancer. The draw's status transition to `locked` acts as a second DB-level guard.

### Role Guards

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
```

Available roles: `player`, `agent`, `admin`. Agents process withdrawals; admins manage platform config, draws, rooms, and agents.

---

## Keno Draw Lifecycle

```text
open → locked → drawn → settled
```

1. Scheduler (`@Cron(EVERY_MINUTE)`) finds draws with `status: open, scheduledAt <= now`
2. Bots buy tickets, then `emitKenoDrawStarted` fires via Socket.IO
3. `executeDraw` → RNG draws 20 unique numbers from 1–80 → settle all tickets
4. `emitKenoDrawCompleted` fires; frontend updates in real time
5. If `config.autoScheduleIntervalMinutes > 0`, the next draw is created at `now + interval`
6. On backend startup (`onApplicationBootstrap`), if no open draw exists and interval > 0, one is created immediately

Admin can manually schedule, execute, or cancel draws from the Admin → Keno panel.
The draw interval is set in Admin → Keno → Config → **Auto-schedule Interval (minutes)**.

---

## Bingo Room Lifecycle

```text
open → running → settled | cancelled
```

Admin creates a room with ticket price, max tickets, scheduled start, and prize tiers (one-line, two-lines, full-house). Players buy tickets. Admin clicks "Draw" repeatedly to reveal numbers one at a time. Settlement triggers automatically when a tier is achieved.

---

## Frontend Architecture

| File | Role |
|---|---|
| `lib/api.ts` | All axios calls, grouped by domain (`kenoApi`, `bingoApi`, `walletApi`, `adminApi`, etc.) |
| `lib/models.ts` | TypeScript types mirroring backend responses |
| `lib/utils.ts` | `formatCredits`, `formatCreditsFull`, `formatDateTime`, `getErrorMessage`, etc. |
| `store/useStore.ts` | Zustand global state: `user`, `wallet`, `authStatus`, `toasts` |
| `App.tsx` | Auth bootstrap, tab routing, credentials login gate |
| `components/BottomNav.tsx` | Role-scoped nav: players see Home/Games/Wallet; agents see Agent; admins see Admin |

### Tab routing

`AppTab = 'home' | 'games' | 'keno' | 'bingo' | 'wallet' | 'admin' | 'agent' | 'profile'`

Controlled by `activeTab` state in `App.tsx`. Pass `onNavigate` prop to pages that need to change tabs.

### Socket.IO events (frontend)

```text
keno.draw.started      → lock countdown display
keno.draw.completed    → reveal animation + reload state
withdrawal.pending     → agent page refresh
bingo.number.drawn     → bingo real-time number reveal
```

---

## Adding a New Feature — Checklist

1. **Backend module** — new controller + service + schema in its own directory; wire into `AppModule`
2. **DTO** — validate all inputs with `class-validator`; add `@ApiTags` + `@ApiOkResponse` decorators
3. **Guard** — protect write endpoints with `JwtAuthGuard` + `RolesGuard`
4. **Money mutations** — go through `WalletService` inside a MongoDB session, never direct writes
5. **Frontend model** — add the new type to `frontend/src/lib/models.ts`
6. **Frontend API call** — add to the relevant group in `frontend/src/lib/api.ts`
7. **TypeScript check** — `npx tsc --noEmit` in both repo root and `frontend/` before considering done

---

## What NOT to Change Without Being Asked

- Do not add real-money payment gateways, KYC, AML, or compliance flows
- Do not hardcode game odds, prices, or prize values — all must be MongoDB-backed config
- Do not call `Math.random()` for any game outcome — use `RngService`
- Do not mutate wallet documents directly — always use `WalletService`
- Do not change Keno draw size (20 numbers from 1–80) or Bingo grid spec (3×9, 15 numbers, 1–90) unless explicitly asked
- Do not make Telegram a hard dependency for the backend — game logic must work without it
