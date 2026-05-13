# iGames Backend Architecture And Implementation Plan

## Summary

iGames will start with a NestJS + MongoDB backend for Keno and 90-ball Bingo. The first release uses ledger-ready credits, not real-money payment rails. The first client can be a Telegram Bot and Telegram Mini App, but the backend must remain standalone, brandable, and saleable as its own product. Telegram should be treated as an authentication and launch-channel adapter, not as the core identity or game model.

The backend exposes REST APIs for account, wallet, ticket, room, and admin workflows, plus WebSocket events for live game updates. MongoDB transactions are required for wallet and settlement safety, so local development should run MongoDB as a replica set. After any supported login method, including Telegram Mini App authentication, the API issues its own iGames JWT/refresh-token pair.

## Reference Basis

- NestJS MongoDB/Mongoose, validation, configuration, security guards, and OpenAPI patterns.
- MongoDB transactions, unique indexes, TTL indexes, and change streams.
- Telegram Mini App `initData` validation and Telegram Login Widget authorization checks from official Telegram documentation.
- OWASP API Security guidance for authentication, authorization, rate limiting, and input validation.
- GLI gaming standards as an audit and RNG design reference, without claiming certification.
- Common Keno rules: 1-80 number pool, 20 numbers drawn, configurable spots and paytables.
- 90-ball Bingo rules: 3x9 tickets, 15 numbers, 1-90 draw pool, one-line, two-line, and full-house win tiers.

Reference links:

- NestJS MongoDB/Mongoose: https://docs.nestjs.com/techniques/mongodb
- NestJS validation: https://docs.nestjs.com/techniques/validation
- NestJS configuration: https://docs.nestjs.com/techniques/configuration
- NestJS OpenAPI: https://docs.nestjs.com/openapi/introduction
- Telegram Mini Apps: https://core.telegram.org/bots/webapps
- Telegram Login Widget: https://core.telegram.org/bots/telegram-login
- MongoDB transactions: https://www.mongodb.com/docs/manual/core/transactions/
- MongoDB unique indexes: https://www.mongodb.com/docs/manual/core/index-unique/
- MongoDB TTL indexes: https://www.mongodb.com/docs/manual/core/index-ttl/
- MongoDB change streams: https://www.mongodb.com/docs/manual/changeStreams/
- OWASP API Security: https://owasp.org/API-Security/
- GLI standards library: https://gaminglabs.com/gli-standards/

## Architecture Overview

### Runtime Components

- **NestJS API app**: REST controllers, WebSocket gateways, validation, auth providers, Telegram adapter services, game services, wallet services, admin services, and scheduled draw workers.
- **Telegram client boundary**: bot commands and Mini App launch flows authenticate through Telegram, then exchange validated Telegram data for first-party iGames tokens.
- **MongoDB replica set**: primary data store for users, wallets, ledger entries, game configs, tickets, draws, rooms, audit logs, idempotency records, and refresh sessions.
- **In-process scheduler for MVP**: runs Keno draws and Bingo room progression. Each scheduled action must use MongoDB uniqueness/status guards so duplicate app instances cannot double-run a draw.
- **Future worker boundary**: scheduling can later move to BullMQ/Redis or a dedicated worker without changing public game APIs.

### NestJS Modules

- `auth`: provider-based login, Telegram auth exchange, optional standalone password login, refresh tokens, JWT issuing, auth guards.
- `users`: player/admin profile records and role assignment.
- `telegram`: Mini App `initData` validation, Login Widget validation if needed, Telegram profile mapping, bot webhook/update handling, and Telegram launch/referral metadata.
- `wallet`: wallet reads, balance projection, balance mutation orchestration.
- `ledger`: immutable financial event records and idempotency enforcement.
- `rng`: cryptographic draw generation and RNG audit records.
- `keno`: Keno configs, ticket purchase, draw execution, result calculation, settlement, and events.
- `bingo`: 90-ball room lifecycle, ticket generation, number draw loop, win detection, settlement, and events.
- `admin`: protected game configuration, paytables, room controls, audit views, and operational tools.
- `common`: DTO helpers, filters, interceptors, request IDs, pagination, error shapes, constants, and shared decorators.

## Data Model

Use MongoDB ObjectIds for internal references and expose string IDs in API responses. Add `createdAt` and `updatedAt` timestamps to mutable documents. Use explicit status enums for workflows.

### Core Collections

- `users`
  - Internal iGames account, display name, roles, status, last login, responsible-gaming flags, and product/tenant metadata for standalone deployments.
  - Unique indexes on optional normalized email and username when standalone password login is enabled.
- `auth_identities`
  - Provider login mappings such as `telegram`, `password`, or future OAuth providers.
  - Fields include `userId`, `provider`, `providerUserId`, `providerUsername`, normalized email when available, profile snapshot, linked timestamp, and last auth timestamp.
  - Unique index on `provider + providerUserId`.
- `refresh_sessions`
  - Refresh token hash, user ID, provider, user agent/device hints, expiration, revocation status, and last-used timestamp.
- `telegram_auth_events`
  - Raw auth metadata summary, Telegram user ID, query ID when present, bot ID/name, `auth_date`, validation result, request ID, and linked `userId`.
- `wallets`
  - `userId`, `currencyCode`, `availableMinor`, `reservedMinor`, `status`.
  - Unique index on `userId + currencyCode`.
- `ledger_entries`
  - Immutable entries for credit, debit, stake, win, refund, adjustment, and reversal.
  - Fields include `userId`, `walletId`, `amountMinor`, `direction`, `balanceAfterMinor`, `sourceType`, `sourceId`, `idempotencyKey`, and metadata.
  - Unique index on `idempotencyKey` when present.
- `game_configs`
  - Active/inactive configs for Keno and Bingo.
  - Include version, game type, paytable/prize settings, ticket price, limits, and effective dates.
- `rng_audit_logs`
  - Algorithm version, game type, game reference, draw input hash, randomness material hash, output numbers, and timestamp.
- `keno_tickets`
  - `userId`, selected numbers, stake, config version, draw ID, status, matches, payout, and settlement status.
- `keno_draws`
  - Config version, scheduled time, drawn numbers, status, RNG audit ID, settlement summary.
- `bingo_rooms`
  - Room config, ticket price, prize pool/tier settings, lifecycle status, current round, scheduled start, and settlement summary.
- `bingo_tickets`
  - `userId`, room ID, round ID, 3x9 grid, marked numbers, tier wins, purchase status, and settlement status.
- `bingo_draws`
  - Room ID, round ID, drawn numbers in order, status, RNG audit IDs or batch audit reference, tier winners, and settlement summary.
- `idempotency_keys`
  - Key, user ID, endpoint/action, request hash, response summary, status, and expiration timestamp.

### Indexing Rules

- Add unique indexes for natural uniqueness: provider identity, optional user email/username, wallet per currency, idempotency key, active room/draw constraints, and settlement locks.
- Add TTL indexes for expired refresh tokens, idempotency records after the retention period, and temporary operational records.
- Add query indexes for common reads: user ledger by date, active Keno draws, user tickets, active Bingo rooms, room tickets, and audit logs by game reference.

## Public API Draft

All protected endpoints require first-party iGames JWT auth. Admin endpoints require an admin role guard. Mutating player endpoints accept an `Idempotency-Key` header. Telegram is used to prove identity at login time; it is not used as the API session token.

### Auth

- `POST /auth/telegram/miniapp`
  - Accepts raw Telegram Mini App `initData`.
  - Validates the received hash on the backend using the configured bot token and Telegram Mini App validation algorithm.
  - Checks `auth_date` freshness.
  - Creates or links the internal iGames user and returns iGames access/refresh tokens.
- `POST /auth/telegram/login-widget`
  - Optional standalone web entry for Telegram Login Widget data.
  - Validates Telegram widget authorization data, creates or links the internal user, and returns iGames tokens.
- `POST /auth/register`
  - Optional standalone-product endpoint. Creates a password identity, hashes password with Argon2id, creates a default wallet, and returns tokens.
- `POST /auth/login`
  - Optional standalone-product endpoint. Verifies password credentials and returns access/refresh tokens.
- `POST /auth/refresh`
  - Rotates refresh token and returns a new access token.
- `POST /auth/logout`
  - Revokes the active refresh token.

### Wallet

- `GET /wallet`
  - Returns current wallet balances as integer minor units.
- `GET /wallet/ledger`
  - Returns paginated ledger entries for the current user.

### Keno

- `GET /keno/config`
  - Returns active spot limits, ticket price rules, and paytable summary.
- `POST /keno/tickets`
  - Purchases a Keno ticket for the next eligible draw.
  - Validates unique selected numbers from 1 to 80 and allowed spot count from 1 to 12.
  - Debits wallet and writes the ledger entry in one transaction.
- `GET /keno/draws/:id`
  - Returns draw status, drawn numbers when complete, and settlement summary.
- `GET /keno/tickets/:id`
  - Returns the player's ticket, matches, payout, and settlement status.

### Bingo

- `GET /bingo/rooms`
  - Lists active and upcoming 90-ball rooms.
- `GET /bingo/rooms/:id/state`
  - Returns room lifecycle status, round state, drawn numbers, prize tiers, and the player's tickets when authenticated.
- `POST /bingo/rooms/:id/tickets`
  - Purchases one or more generated 90-ball tickets before the room starts.
  - Debits wallet and writes ledger entries transactionally.

### Admin

- `GET /admin/game-configs`
- `POST /admin/game-configs`
- `PATCH /admin/game-configs/:id`
- `POST /admin/bingo/rooms`
- `PATCH /admin/bingo/rooms/:id`
- `POST /admin/keno/draws`
- `GET /admin/audit/rng`
- `GET /admin/audit/ledger`
- `GET /admin/settlements/:sourceId`

Admin config changes must create audit records and should use versioned configs instead of editing historical game behavior in place.

## WebSocket Events

Use authenticated sockets for player-specific ticket information and public room/draw channels for non-sensitive live state.

- `keno.draw.started`
  - Payload: draw ID, scheduled time, config version.
- `keno.draw.completed`
  - Payload: draw ID, drawn numbers, settlement status.
- `bingo.room.updated`
  - Payload: room ID, lifecycle status, ticket sales summary, next draw time.
- `bingo.number.drawn`
  - Payload: room ID, round ID, number, draw index, drawn numbers count.
- `bingo.claim.confirmed`
  - Payload: room ID, round ID, tier, winning ticket IDs visible only where appropriate.
- `bingo.round.completed`
  - Payload: room ID, round ID, final drawn numbers, winners summary, settlement status.

## Transaction And Ledger Rules

- Ticket purchase must debit `wallet.availableMinor` and create a `ledger_entries` record in the same MongoDB transaction.
- Settlement must credit winnings and create win ledger entries in the same MongoDB transaction.
- Failed settlement retries must be safe. A settled ticket or draw must not settle again.
- Idempotency keys must protect ticket purchase, admin-triggered draws, and settlement retries.
- Ledger entries are append-only. Corrections require reversal or adjustment entries.
- Balance responses should be derived from wallet state, while audit and reconciliation should use ledger entries.

## Authentication Architecture

The backend owns the canonical user session. External launch channels only prove who the user is.

- `User` is the internal account used by wallet, ledger, tickets, draws, admin roles, and audit logs.
- `AuthIdentity` links one internal user to one or more providers, beginning with Telegram.
- Telegram Mini App login receives raw `initData` from the Mini App frontend. The backend must parse it, remove the `hash`, build the Telegram data-check string, derive the secret from the bot token using `WebAppData`, compare the HMAC-SHA-256 hash, and reject stale `auth_date` values.
- Telegram Login Widget support is optional for standalone web use. It uses Telegram's widget authorization hash validation and should map to the same `AuthIdentity` model.
- After provider validation, issue normal iGames JWT access tokens and refresh tokens. All game APIs use these first-party tokens, which keeps Keno, Bingo, wallet, and admin modules independent from Telegram.
- Multiple product modes should be supported through config:
  - `telegram_only`: only Telegram provider login is exposed.
  - `standalone`: password login/register is exposed.
  - `hybrid`: Telegram and standalone auth are both exposed.
- Do not trust Telegram profile fields as permanent account data. Store a profile snapshot, but key identity by Telegram numeric user ID and provider.
- Bot webhook commands should call backend services through the same application service layer as REST controllers, not duplicate game or wallet logic.

## RNG Design

- Use Node.js `crypto` APIs for randomness. Do not use `Math.random()` for any game result.
- Provide an `RngService` with methods for drawing unique numbers without replacement.
- Record algorithm version, game type, game reference, input parameters, output numbers, timestamp, and hashes of randomness material.
- Store enough audit evidence for internal verification without exposing material that could predict future outcomes.
- Keep RNG output deterministic only within the stored audit context needed for verification; never reuse randomness across games.

## Keno Flow

1. Admin creates or activates a Keno config with allowed spots, ticket pricing, schedule, and paytable.
2. Player purchases a ticket for the next eligible draw.
3. API validates:
   - Selected numbers are unique.
   - Every number is between 1 and 80.
   - Spot count is allowed, initially 1 to 12.
   - Stake is allowed by the active config.
4. Wallet is debited and ledgered transactionally.
5. Scheduler locks an eligible draw and uses `RngService` to draw 20 unique numbers from 1 to 80.
6. Service calculates matches for each ticket and looks up payout from the active config version.
7. Winning tickets are credited through wallet/ledger transactions.
8. REST and WebSocket clients receive completed draw and ticket result updates.

## 90-Ball Bingo Flow

1. Admin creates a room with ticket price, start time, max tickets, prize tiers, and config version.
2. Player buys generated tickets while the room is open.
3. Ticket generator creates valid 3x9 tickets:
   - 3 rows and 9 columns.
   - 15 numbers total.
   - 5 numbers per row.
   - Numbers are unique within the ticket.
   - Column ranges follow 90-ball convention: 1-9, 10-19, 20-29, ..., 80-90.
4. Wallet is debited and ledgered transactionally.
5. Room starts after configured criteria or scheduled time.
6. Scheduler draws numbers from 1 to 90 without replacement.
7. After each number, the service marks matching ticket cells and detects:
   - One-line winner.
   - Two-line winner.
   - Full-house winner.
8. Same-tier simultaneous winners split that tier's prize using integer minor units. Any remainder follows a documented deterministic rule, such as assigning leftover minor units by earliest ticket purchase time.
9. Settlement credits winners through wallet/ledger transactions.
10. The round completes after full house settlement or configured end criteria.

## Security

- Hash passwords with Argon2id when standalone password login is enabled.
- Validate Telegram Mini App `initData` server-side; never accept frontend-only Telegram validation.
- Reject stale Telegram `auth_date` values and log failed validation attempts without storing sensitive raw tokens.
- Use short-lived JWT access tokens and refresh-token rotation.
- Store refresh token hashes, not raw refresh tokens.
- Use role-based guards for admin and system actions.
- Apply request validation globally with DTOs.
- Add rate limits for auth, ticket purchase, and high-frequency reads.
- Use structured errors and avoid exposing stack traces or internal settlement details.
- Add CORS configuration by environment.
- Store secrets in environment variables and validate required config at boot.

## Observability And Audit

- Add request ID middleware/interceptor and include request IDs in logs.
- Use structured logs for auth, wallet, ledger, RNG, draw, settlement, and admin events.
- Record audit logs for sensitive user actions, admin config mutations, game result generation, and settlement.
- Track operational metrics:
  - Ticket purchase count and failures.
  - Settlement attempts and failures.
  - Draw duration.
  - Wallet transaction latency.
  - Duplicate idempotency attempts.
- Keep audit logs queryable by user ID, game type, source ID, and date.

## Implementation Phases

### Phase 1: Backend Foundation

- Scaffold NestJS with TypeScript, validation pipe, config module, health endpoint, OpenAPI, and environment validation.
- Add Docker Compose for MongoDB replica set.
- Add baseline lint, test, and start scripts.
- Add common error shape, request ID handling, pagination helpers, and shared decorators.

### Phase 2: Auth And Users

- Implement provider-based auth with `User`, `AuthIdentity`, and `RefreshSession`.
- Implement Telegram Mini App auth exchange as the first login provider.
- Implement optional standalone password registration/login behind config.
- Create default wallet on first successful user creation in a transaction.
- Add auth guards, role guards, and basic rate limits.

### Phase 3: Wallet And Ledger

- Implement wallet reads and paginated ledger reads.
- Implement transactional debit/credit services.
- Add immutable ledger entries, idempotency records, and unique indexes.
- Add integration tests for debit, credit, and duplicate idempotency behavior.

### Phase 4: RNG And Audit

- Implement `RngService` using Node `crypto`.
- Add unique draw-without-replacement helpers.
- Add RNG audit log persistence.
- Unit-test draw uniqueness and range guarantees.

### Phase 5: Keno

- Implement Keno config and paytable management.
- Implement ticket purchase, draw creation/locking, RNG draw execution, match calculation, payout lookup, settlement, REST APIs, and WebSocket events.
- Add tests for validation, payout, idempotent settlement, and duplicate draw protection.

### Phase 6: 90-Ball Bingo

- Implement room lifecycle, ticket generation, ticket purchase, draw loop, win detection, tier splitting, settlement, REST APIs, and WebSocket events.
- Add tests for ticket validity, line/two-line/full-house detection, simultaneous winners, and settlement retry.

### Phase 7: Admin And Operations

- Add admin APIs for configs, paytables, room lifecycle, audit views, and settlement inspection.
- Add seed scripts for local Keno and Bingo configs.
- Add operational docs for local setup, environment variables, and common runbooks.

### Phase 8: Hardening

- Add E2E tests for full Keno and Bingo player journeys.
- Add security tests for role restrictions and malformed payloads.
- Add observability checks, structured logs, and failure-path tests for settlement retries.

## Test Plan

### Unit Tests

- Keno selected-number validation rejects duplicates and out-of-range numbers.
- Keno draw generation always returns 20 unique numbers from 1 to 80.
- Keno match counting and payout lookup match the active paytable.
- 90-ball ticket generation creates 3x9 grids with 15 numbers and 5 numbers per row.
- 90-ball ticket columns use the correct number ranges.
- Bingo win detection correctly identifies one-line, two-line, and full-house outcomes.
- Ledger calculations maintain integer minor-unit balances.
- Idempotency request hashes reject conflicting reuse of the same key.

### Integration Tests

- Telegram Mini App auth with valid signed `initData` creates or links a user, token pair, and default wallet.
- Telegram Mini App auth rejects bad hashes and stale `auth_date` values.
- Standalone register/login creates a user, token pair, and default wallet when standalone auth is enabled.
- Ticket purchase debits wallet and creates one ledger entry.
- Winning Keno settlement credits wallet and creates one win ledger entry.
- Winning Bingo settlement splits same-tier prizes correctly.
- Duplicate idempotency key returns the prior result without double debit.
- Failed settlement retry does not corrupt balances.
- Admin-only config changes are blocked for player roles.

### E2E Scenarios

- Player registers, buys a Keno ticket, draw completes, and result settles.
- Multiple players buy Bingo tickets, room starts, numbers draw, winners are detected, and prizes settle.
- Scheduler restart or duplicate worker attempt does not run the same draw twice.
- Malformed payloads return validation errors without side effects.

## Assumptions And Defaults

- The backend starts as credits-only and ledger-ready.
- Telegram Bot/Mini App is the first expected client, but the backend remains usable without Telegram through configurable auth providers.
- The internal iGames user ID is the canonical owner for wallets, tickets, roles, and ledger entries.
- No payment processing, KYC, AML, tax reporting, licensing workflow, or jurisdiction-specific launch compliance is included in this phase.
- 90-ball Bingo ships before 75-ball Bingo.
- Game paytables, ticket prices, room prize values, and limits are admin-configured.
- MongoDB transactions are required, so every environment that runs settlement must use a replica set.
- The MVP scheduler runs inside the NestJS app, protected by database locks and statuses.
- WebSocket payloads expose public game state by default and only expose player-specific ticket data to authenticated owners or admins.
