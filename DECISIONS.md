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
