# iGames — Development Standard

The canonical way to develop, configure, and ship this project. Read alongside
[CLAUDE.md](CLAUDE.md) (domain rules) — this doc covers **workflow and environments**,
CLAUDE.md covers **what the code must always do** (ledger, RNG, integer minor units, etc.).

---

## 1. Environments at a glance

We run **two fully isolated environments**. Nothing is shared between them — not the
Telegram bot, not the database, not Redis, not secrets.

| Concern | Development | Production |
|---|---|---|
| Telegram bot | `@YourGame_dev_bot` (its own token) | `@YourGame_bot` (its own token) |
| Bot transport | Long polling (no public URL needed) | Webhook (`TELEGRAM_WEBHOOK_URL` set) |
| Database | `igames_dev` (local MySQL) | `igames` (prod MySQL) |
| Redis | local `redis://127.0.0.1:6379` | prod Redis instance |
| `NODE_ENV` | `development` | `production` |
| Frontend API base | Vite proxy `/api` (unset `VITE_API_URL`) | absolute origin, e.g. `https://api.yourdomain.com` |
| Mini App URL | HTTPS tunnel to local frontend | `https://app.yourdomain.com` |
| Auth mode | `standalone` or `hybrid` (log in without Telegram) | `hybrid` or `telegram_only` |

> **Golden rule:** a dev action must never be able to touch prod data or the prod bot.
> Separate tokens + separate databases enforce this at the boundary.

---

## 2. Two Telegram bots (dev + prod)

Telegram bots are created manually in **@BotFather** — one bot = one token. Create two.

### 2.1 Create each bot

In @BotFather:
1. `/newbot` → name it (e.g. *AddisPlay Dev*), username must end in `bot`
   (e.g. `AddisPlay_dev_bot`). Copy the token → this is `TELEGRAM_BOT_TOKEN` for **dev**.
2. Repeat `/newbot` for production (e.g. `AddisPlay_bot`). Copy that token for **prod**.

Keep the two tokens in the matching `.env` files (see §3). **Never** put the prod token
on a dev machine.

### 2.2 Configure the Mini App per bot

For each bot, in @BotFather → `/mybots` → select bot → **Bot Settings**:
- **Menu Button / Mini App** → set the Web App URL:
  - Dev bot → your HTTPS tunnel to the local frontend (see §5.3), e.g. `https://dev-xxxx.trycloudflare.com`
  - Prod bot → `https://app.yourdomain.com`
- (Login Widget only) `/setdomain` → the domain allowed to use Telegram Login.

### 2.3 How the backend picks transport (already implemented)

`src/telegram/telegram-bot.service.ts` decides automatically:
- If **`TELEGRAM_WEBHOOK_URL` is set** → registers a webhook at that URL
  (prod → `https://api.yourdomain.com/telegram/webhook`).
- If **not set** → starts **long polling** (dev — no public URL required).

So the *only* difference between the two environments' bot behaviour is whether
`TELEGRAM_WEBHOOK_URL` is present. Dev leaves it blank; prod sets it.

> Two bots can't both long-poll or both own the same webhook for the same token —
> that's why each environment needs its **own** bot/token. Running the dev bot locally
> while the prod bot is live is then completely safe.

---

## 3. Configuration & secrets

Config is loaded and **validated** at boot in `src/config/env.validation.ts`
(missing/invalid required vars fail fast). Never read `process.env` directly in
feature code — inject `ConfigService`.

### 3.1 Backend `.env` (never commit real values)

`.env.example` is the template. Copy it to `.env` per machine. Key differences:

**Development `.env`:**
```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_DATABASE=igames_dev
DB_USERNAME=igames_dev
DB_PASSWORD=devpass

REDIS_URL=redis://127.0.0.1:6379

JWT_ACCESS_SECRET=<dev-only random 32 bytes>
JWT_REFRESH_SECRET=<dev-only random 32 bytes>

TELEGRAM_BOT_TOKEN=<DEV bot token>
TELEGRAM_MINIAPP_URL=https://dev-xxxx.trycloudflare.com
# TELEGRAM_WEBHOOK_URL intentionally UNSET → long polling
AUTH_MODE=hybrid            # lets you log in with email/password, no Telegram needed

ALLOWED_ORIGIN=http://localhost:5173
```

**Production `.env`:**
```env
NODE_ENV=production
PORT=3000

DB_HOST=<prod host>
DB_DATABASE=igames
DB_USERNAME=<prod user>
DB_PASSWORD=<strong secret>

REDIS_URL=<prod redis url>

JWT_ACCESS_SECRET=<prod secret, different from dev>
JWT_REFRESH_SECRET=<prod secret, different from dev>

TELEGRAM_BOT_TOKEN=<PROD bot token>
TELEGRAM_MINIAPP_URL=https://app.yourdomain.com
TELEGRAM_WEBHOOK_URL=https://api.yourdomain.com/telegram/webhook
AUTH_MODE=hybrid

ALLOWED_ORIGIN=https://app.yourdomain.com   # required in production (boot fails without it)
```

### 3.2 Frontend env (Vite)

- **Dev:** leave `VITE_API_URL` unset — the app calls `/api` and Vite proxies it to the
  backend. Uses `import.meta.env.DEV` to expose dev-only helpers (e.g. wallet top-up).
- **Prod:** `frontend/.env.production` sets `VITE_API_URL` to the absolute backend origin
  (e.g. `https://api.yourdomain.com`). This is also the Socket.IO URL.

### 3.3 Secret hygiene

- `.env` files are git-ignored — commit only `.env.example` (placeholders).
- Dev and prod **JWT secrets and bot tokens must differ**. Rotating a leaked secret
  should never require touching the other environment.
- Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## 4. Prerequisites

- Node.js (match the version the team standardizes on) + npm
- MySQL 8 running locally, with an `igames_dev` database + user
- Redis running locally (`redis-server`) — used for scheduler leader locks and
  Socket.IO scaling; some real-time features (Werk round leader, presence) need it
- (Optional) a tunnel tool for Mini App testing: `cloudflared` or `ngrok`

---

## 5. Local development workflow

### 5.1 First-time setup
```bash
# backend
cp .env.example .env          # then fill in dev values (§3.1)
npm install
npm run schema:sync           # create/upgrade tables (TypeORM), safe to re-run
npm run seed:dev              # seed dev data (configs, bots, demo rows)

# frontend
cd frontend && npm install
```

### 5.2 Run it (two terminals)
```bash
npm run start:dev             # backend on :3000, watch mode
cd frontend && npm run dev    # frontend on :5173, proxies /api → :3000
```
Open `http://localhost:5173`. With `AUTH_MODE=hybrid`/`standalone` you can register/log
in with email + password — **no Telegram required** for day-to-day work. Dev-only helpers
(e.g. wallet top-up on the Wallet page) appear because `import.meta.env.DEV` is true.

### 5.3 Testing the Telegram Mini App locally (when you actually need it)
Telegram requires HTTPS, so expose the local frontend through a tunnel:
```bash
cloudflared tunnel --url http://localhost:5173     # prints an https URL
```
Then set that URL as the **dev bot's** Mini App URL in @BotFather (§2.2) and as
`TELEGRAM_MINIAPP_URL` in dev `.env`. Open the dev bot in Telegram → Menu button.
The dev bot long-polls, so no inbound webhook/tunnel to the backend is needed.

---

## 6. Git & branching standard

- `main` = **production**. Always deployable. Never commit directly.
- Feature branches off `main`: `feat/<short-name>`, `fix/<short-name>`, `chore/<...>`.
  (Current in-flight example: `migration/mysql`.)
- **Conventional commits** (matches existing history): `feat:`, `fix:`, `chore:`,
  `refactor:`, `docs:`, `test:`. One logical change per commit.
- Open a PR into `main`. Keep PRs focused (one module/behaviour — see CLAUDE.md
  "Implementation Discipline").
- Use `/code-review` on your working diff before requesting review; `/code-review ultra`
  for a deeper multi-agent pass on risky changes.

---

## 7. Quality gates (run before every PR)

| Check | Command | Must pass |
|---|---|---|
| Backend types | `npx tsc --noEmit -p tsconfig.json` | no errors |
| Frontend types | `cd frontend && npx tsc --noEmit -p tsconfig.app.json` | no errors |
| Lint | `npm run lint` (and `cd frontend && npm run lint`) | clean |
| Unit tests | `npm run test:unit` | green |
| Full suite (when touching game/wallet logic) | `npm test` | green |

**Always** unit-test game math + wallet behaviour when you touch it (Keno/Bingo/Crash/Werk
outcomes, payouts, idempotency). Integration-test wallet debits/credits and duplicate
idempotency keys. These are non-negotiable per CLAUDE.md.

---

## 8. Database & data

- TypeORM entities are the schema source of truth. Apply changes with
  `npm run schema:sync` (wraps `dist/scripts/ensure-schema.js`); several services also
  self-heal missing tables on boot.
- `schema:sync` creates new tables, adds new columns, widens enums, **and adds any
  declared index a live index doesn't already cover**. Index matching is by *column
  set*, not name, so an index added by hand under a different name is recognised and
  never duplicated. It only ever ADDS — it never drops or alters an existing index, so
  it can't reintroduce the drop/recreate churn that makes TypeORM's `synchronize`
  unstable on MySQL. Two situations are logged for a human rather than applied
  automatically: adding a `UNIQUE` index when a non-unique one already covers the
  columns (could fail on existing duplicate rows), and an index name already taken by a
  different column set. So a new entity index — e.g. `users.locationId` — applies on the
  next boot or `npm run schema:sync` with no manual SQL.
- **Never** mutate a wallet balance without an immutable ledger entry in the *same*
  transaction. Money is always **integer minor units** — never floats.
- Game rules, paytables, prices, and win-control knobs are **DB-backed config rows**,
  not hardcoded. Add seed/config rows, don't inline business values.
- Keep dev and prod databases separate and never point a dev backend at prod DB creds.

---

## 9. Deployment (production)

Build and run the compiled output; set the prod env (incl. `TELEGRAM_WEBHOOK_URL` so the
bot registers a webhook instead of polling):
```bash
npm ci
npm run build                 # nest build → dist/
npm run schema:sync           # apply schema on the prod DB
cd frontend && npm ci && npm run build   # → frontend/dist (served by nginx/CDN)
node dist/main                # or: npm run start:prod  (behind PM2/systemd)
```
- Front the backend with **nginx/Caddy** for TLS + WebSocket upgrade; serve
  `frontend/dist` statically.
- Run under **PM2/systemd** with auto-restart. Multi-instance is safe: game-round
  leadership is elected via a Redis lock and player input is routed to the leader, so
  you can scale API instances horizontally.
- Point the **prod** bot's webhook + Mini App URL at the prod domains only.

---

## 10. Pre-PR checklist

- [ ] Change is scoped to one module/behaviour
- [ ] No secrets, tokens, or `.env` values committed
- [ ] Backend **and** frontend typecheck clean
- [ ] Lint clean
- [ ] Unit tests added/updated and passing for any game/wallet/RNG change
- [ ] Wallet mutations go through the ledger in one transaction; money stays integer minor units
- [ ] New tunables are DB/config-backed, not hardcoded
- [ ] Ran `/code-review` on the diff
- [ ] Verified against the **dev** bot/DB — never prod

---

### Appendix — environment variable reference

| Var | Dev | Prod | Notes |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | gates dev helpers; prod requires `ALLOWED_ORIGIN` |
| `TELEGRAM_BOT_TOKEN` | dev token | prod token | **must differ** |
| `TELEGRAM_MINIAPP_URL` | tunnel URL | app domain | HTTPS required by Telegram |
| `TELEGRAM_WEBHOOK_URL` | *(unset → polling)* | `…/telegram/webhook` | presence toggles webhook vs polling |
| `AUTH_MODE` | `hybrid`/`standalone` | `hybrid`/`telegram_only` | dev can skip Telegram login |
| `DB_DATABASE` | `igames_dev` | `igames` | isolated databases |
| `REDIS_URL` | local | prod | leader locks + socket scaling |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev secrets | prod secrets | **must differ** |
| `ALLOWED_ORIGIN` | `http://localhost:5173` | app origin | required in prod |
| `VITE_API_URL` (frontend) | *(unset → `/api`)* | backend origin | also the Socket.IO URL |
