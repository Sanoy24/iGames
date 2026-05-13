# iGames Backend — Technical Architecture

> NestJS + MongoDB backend for a Telegram Mini App gaming platform supporting Keno and 90-ball Bingo, with Telebirr payment integration.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Module Map](#2-module-map)
3. [Data Models](#3-data-models)
4. [API Reference](#4-api-reference)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Wallet & Ledger System](#6-wallet--ledger-system)
7. [Payment Flow — Telebirr](#7-payment-flow--telebirr)
8. [Keno Game Flow](#8-keno-game-flow)
9. [Bingo Game Flow](#9-bingo-game-flow)
10. [RNG Service](#10-rng-service)
11. [Configuration & Environment](#11-configuration--environment)
12. [Local Development & Docker](#12-local-development--docker)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Telegram Mini App (client)              │
│              HTTPS REST  ·  initData auth                │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              NestJS API  (port 3000)                     │
│                                                         │
│  RequestIdMiddleware → ValidationPipe → Guards          │
│  HttpExceptionFilter  ·  Swagger at /docs               │
│                                                         │
│  Modules: auth · users · telegram · wallet · ledger     │
│           payments · keno · bingo · rng · health        │
└────────────────────────┬────────────────────────────────┘
                         │  Mongoose / replica set
                         ▼
┌─────────────────────────────────────────────────────────┐
│              MongoDB 7  (replica set rs0)                │
│  Required for multi-document transactions                │
└─────────────────────────────────────────────────────────┘
```

### Global infrastructure (applied in `main.ts` / `AppModule`)

| Component | Detail |
|---|---|
| `RequestIdMiddleware` | Applied to all routes. Reads `x-request-id` header or generates UUID v4. Echoes value back in response header. |
| `ValidationPipe` | `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` |
| `HttpExceptionFilter` | Shapes all 4xx/5xx responses to `{ statusCode, error, message, path, requestId, timestamp }` |
| Swagger | Available at `GET /docs`. Bearer auth configured. |
| CORS | `origin: true`, `credentials: true` |

---

## 2. Module Map

### Dependency graph

```
AppModule
├── ConfigModule (global)
├── MongooseModule (global)
├── AuthModule
│   ├── TelegramModule
│   ├── UsersModule
│   └── WalletModule
│       └── LedgerModule
├── PaymentsModule
│   └── WalletModule
├── KenoModule
│   ├── RngModule
│   └── WalletModule
├── BingoModule
│   ├── RngModule
│   └── WalletModule
├── TelegramModule   (also imported directly by AppModule)
├── UsersModule
├── WalletModule
├── RngModule
└── HealthModule
```

### Module responsibilities

| Module | Responsibility | Exports |
|---|---|---|
| `auth` | Telegram Mini App login, JWT issuance, refresh sessions | `AuthService` |
| `users` | User + AuthIdentity upsert | `UsersService` |
| `telegram` | `initData` HMAC verification | `TelegramMiniAppAuthService` |
| `wallet` | Balance reads, debit/credit mutations | `WalletService`, `MongooseModule` |
| `ledger` | Ledger entries, idempotency records | `LedgerService`, `MongooseModule` |
| `payments` | Telebirr receipt submission and wallet top-up | — |
| `keno` | Keno config, draws, tickets, settlement | `KenoService` |
| `bingo` | Bingo rooms, tickets, draw progression, settlement | `BingoService` |
| `rng` | Cryptographic draw-without-replacement + audit log | `RngService` |
| `health` | `GET /health` liveness check | — |
| `common` | `HttpExceptionFilter`, `RequestIdMiddleware` (global, not a `@Module`) | — |

> **Key boundary:** `TelegramModule` is used only for authentication. `WalletModule`, `LedgerModule`, `KenoModule`, and `BingoModule` have no dependency on Telegram.

---

## 3. Data Models

> All monetary fields are stored as **integer minor units**. Floating-point values are never used for balances or payouts.
> Minor-unit fields: `availableMinor`, `reservedMinor`, `amountMinor`, `balanceAfterMinor`, `stakeMinor`, `payoutMinor`, `ticketPriceMinor`, `prizeMinor`, `oneLineMinor`, `twoLinesMinor`, `fullHouseMinor`.

### `users`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `displayName` | String | required |
| `email` | String | optional, unique sparse |
| `username` | String | optional, unique sparse |
| `roles` | String[] | enum: `player` \| `admin` \| `system`, default `['player']` |
| `status` | String | enum: `active` \| `suspended` \| `closed`, default `active` |
| `lastLoginAt` | Date | optional |
| `responsibleGamingFlags` | Object | default `{}` |
| `productMetadata` | Object | default `{}` |
| `createdAt` / `updatedAt` | Date | auto |

### `auth_identities`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId → User | required, indexed |
| `provider` | String | enum: `telegram` \| `password` |
| `providerUserId` | String | required |
| `providerUsername` | String | optional |
| `normalizedEmail` | String | optional |
| `profileSnapshot` | Object | default `{}` |
| `linkedAt` | Date | required |
| `lastAuthAt` | Date | required |

**Indexes:** `{ provider, providerUserId }` unique

### `refresh_sessions`

| Field | Type | Notes |
|---|---|---|
| `_id` | String (UUID) | set to `refreshSessionId` |
| `userId` | ObjectId → User | required, indexed |
| `provider` | String | `telegram` \| `password` |
| `refreshTokenHash` | String | SHA-256 of raw token — raw token never stored |
| `expiresAt` | Date | required, indexed |
| `revokedAt` | Date | optional |
| `lastUsedAt` | Date | optional |

**Indexes:** `{ expiresAt }` TTL (`expireAfterSeconds: 0`) — MongoDB auto-deletes expired sessions

### `wallets`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId → User | required, indexed |
| `currencyCode` | String | default `CREDIT` |
| `availableMinor` | Number | spendable balance, min 0 |
| `reservedMinor` | Number | held for in-flight ops, min 0 |
| `status` | String | enum: `active` \| `locked` \| `closed`, default `active` |

**Indexes:** `{ userId, currencyCode }` unique

### `ledger_entries`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId → User | required, indexed |
| `walletId` | ObjectId → Wallet | required, indexed |
| `currencyCode` | String | required |
| `amountMinor` | Number | min 1 |
| `direction` | String | `credit` (increases balance) \| `debit` (decreases balance) |
| `entryType` | String | `stake` \| `win` \| `refund` \| `adjustment` \| `bonus` \| `deposit` \| `reversal` |
| `sourceType` | String | e.g. `keno_ticket`, `bingo_ticket`, `telebirr_receipt` |
| `sourceId` | String | ID of the source document |
| `idempotencyKey` | String | optional |
| `balanceAfterMinor` | Number | wallet balance after this entry |
| `metadata` | Object | default `{}` |

**Indexes:** `{ userId, createdAt: -1 }` · `{ sourceType, sourceId }` · `{ userId, sourceType, idempotencyKey }` unique sparse

> Ledger entries are **append-only**. No updates or deletes. Corrections use `entryType: "reversal"` or `"adjustment"`.

### `idempotency_records`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `key` | String | client-supplied idempotency key |
| `userId` | ObjectId → User | required, indexed |
| `action` | String | e.g. `wallet.debit.stake.keno_ticket` |
| `requestHash` | String | SHA-256 of stable-serialized request body |
| `status` | String | `pending` \| `completed` \| `failed` |
| `response` | Object | cached result, set on completion |
| `expiresAt` | Date | 24 h from creation |

**Indexes:** `{ key, userId, action }` unique · `{ expiresAt }` TTL (`expireAfterSeconds: 0`)

### `telebirr_deposits`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId → User | required, indexed |
| `receiptNo` | String | required, **unique** |
| `amountMinor` | Number | min 1 |
| `currencyCode` | String | default `CREDIT` |
| `status` | String | `credited` \| `rejected` |
| `payerName` | String | optional |
| `payerPhone` | String | optional |
| `creditedPartyName` | String | optional |
| `creditedPartyAccount` | String | optional |
| `transactionStatus` | String | raw value from receipt |
| `parsedReceipt` | Object | full parsed receipt object |
| `verification` | Object | receiver match results |
| `walletCredit` | Object | `WalletMutationResult` snapshot |

**Indexes:** `{ userId, createdAt: -1 }` · `receiptNo` unique (prevents double-credit)

### `keno_configs`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `name` | String | required |
| `version` | Number | auto-incremented, unique |
| `status` | String | `active` \| `inactive`, indexed |
| `numberMin` | Number | default 1 |
| `numberMax` | Number | default 80 |
| `drawSize` | Number | default 20 |
| `allowedSpots` | Number[] | default `[1..12]` |
| `ticketPriceMinor` | Number | min 1 |
| `paytable` | KenoPaytableEntry[] | see below |

**KenoPaytableEntry** (embedded, no `_id`):

| Field | Type | Constraints |
|---|---|---|
| `spots` | Number | 1–12 |
| `matches` | Number | 0–12 |
| `payoutMultiplier` | Number | ≥ 0 |

**Indexes:** `{ status }` · `{ version }` unique

### `keno_draws`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `configId` | ObjectId → KenoConfig | indexed |
| `configVersion` | Number | snapshot of config version |
| `status` | String | `open` \| `locked` \| `drawn` \| `settled` \| `cancelled` |
| `scheduledAt` | Date | indexed |
| `drawnNumbers` | Number[] | populated after RNG |
| `rngAuditLogId` | String | ObjectId of `RngAuditLog` |
| `executedAt` | Date | optional |
| `settledAt` | Date | optional |
| `settlementSummary` | Object | `{ ticketCount, winners, totalStakeMinor, totalPayoutMinor }` |

**Indexes:** `{ status, scheduledAt }`

### `keno_tickets`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId → User | indexed |
| `drawId` | ObjectId → KenoDraw | indexed |
| `configId` | ObjectId → KenoConfig | |
| `configVersion` | Number | |
| `selectedNumbers` | Number[] | sorted ascending |
| `stakeMinor` | Number | min 1 |
| `matches` | Number | computed at settlement |
| `payoutMinor` | Number | computed at settlement |
| `status` | String | `pending` \| `won` \| `lost` \| `cancelled` |
| `settlementStatus` | String | `pending` \| `settled` |
| `idempotencyKey` | String | client-supplied |
| `walletDebit` | Object | snapshot of debit result |
| `walletCredit` | Object | snapshot of credit result |

**Indexes:** `{ userId, createdAt: -1 }` · `{ drawId, settlementStatus }` · `{ userId, idempotencyKey }` unique

### `bingo_rooms`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `name` | String | required |
| `status` | String | `open` \| `running` \| `completed` \| `cancelled` |
| `ticketPriceMinor` | Number | min 1 |
| `maxTickets` | Number | min 1 |
| `prizes` | BingoPrizeConfig | see below |
| `scheduledStartAt` | Date | indexed |
| `drawnNumbers` | Number[] | grows one number per draw call |
| `rngAuditLogIds` | String[] | one entry per drawn number |
| `settledTiers` | String[] | `one_line` \| `two_lines` \| `full_house` |
| `winnersByTier` | Object | `{ tier: ticketId[] }` |
| `settlementSummary` | Object | per-tier prize breakdown |

**BingoPrizeConfig** (embedded):

| Field | Type |
|---|---|
| `oneLineMinor` | Number ≥ 0 |
| `twoLinesMinor` | Number ≥ 0 |
| `fullHouseMinor` | Number ≥ 0 |

**Indexes:** `{ status, scheduledStartAt }`

### `bingo_tickets`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId → User | indexed |
| `roomId` | ObjectId → BingoRoom | indexed |
| `grid` | Number\|null[][] | 3×9, 15 numbers |
| `markedNumbers` | Number[] | updated each draw call |
| `completedLines` | Number[] | row indices (0, 1, 2) |
| `wonTiers` | String[] | tiers won by this ticket |
| `stakeMinor` | Number | min 1 |
| `payoutMinor` | Number | cumulative across tiers |
| `status` | String | `active` \| `won` \| `lost` \| `cancelled` |
| `settlementStatus` | String | `pending` \| `settled` |
| `purchaseIdempotencyKey` | String | client-supplied |
| `walletDebit` | Object | debit snapshot |
| `walletCredits` | Object[] | one entry per tier won |

**Indexes:** `{ userId, createdAt: -1 }` · `{ roomId, userId, purchaseIdempotencyKey }` · `{ roomId, settlementStatus }`

### `rng_audit_logs`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `gameType` | String | `keno` \| `bingo` |
| `gameReference` | String | draw/room ID (or `roomId:callIndex` for bingo) |
| `algorithmVersion` | String | `crypto-random-int-without-replacement-v1` |
| `inputHash` | String | SHA-256 of stable-JSON input params |
| `randomnessMaterialHash` | String | SHA-256 of 32 random bytes |
| `outputNumbers` | Number[] | the drawn numbers |
| `min` | Number | range start |
| `max` | Number | range end |
| `count` | Number | numbers drawn |
| `metadata` | Object | context (configVersion, remainingNumbers, etc.) |
| `createdAt` / `updatedAt` | Date | auto |

**Indexes:** `{ gameType, gameReference }` · `{ createdAt: -1 }`

---

## 4. API Reference

### Error response shape (all 4xx / 5xx)

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "receiptNo or receiptUrl is required",
  "path": "/payments/telebirr/receipts",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### `x-request-id` header

- If the client sends `x-request-id`, the middleware uses that value.
- Otherwise a UUID v4 is generated.
- The resolved value is echoed in the `x-request-id` **response** header and included as `requestId` in all error responses.

### Idempotency

Endpoints that accept an `Idempotency-Key` header replay the cached response for 24 hours if the same key is reused with the same request body. Reusing a key with a different body returns HTTP 409.

---

### `auth` — Authentication

#### `POST /auth/telegram/miniapp`

Authenticate a Telegram Mini App user.

| | |
|---|---|
| Auth | Public |
| Body | `{ initData: string }` — raw URL-encoded string from Telegram SDK |

**Response 201**
```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": { "id": "665f...", "displayName": "Jane Player", "roles": ["player"] }
}
```

**Errors:** 401 (invalid/stale initData), 400 (missing fields)

---

### `wallet` — Wallet

All wallet endpoints require `Authorization: Bearer <accessToken>`.

#### `GET /wallet`

Returns the authenticated user's default wallet.

**Response 200**
```json
{
  "id": "665f...",
  "userId": "665f...",
  "currencyCode": "CREDIT",
  "availableMinor": 5000,
  "reservedMinor": 0,
  "status": "active"
}
```

#### `GET /wallet/ledger?limit=50`

Returns the user's ledger entries, newest first. `limit` default 50, max 100.

**Response 200** — array of:
```json
{
  "id": "665f...",
  "walletId": "665f...",
  "currencyCode": "CREDIT",
  "amountMinor": 100,
  "direction": "debit",
  "entryType": "stake",
  "sourceType": "keno_ticket",
  "sourceId": "665f...",
  "idempotencyKey": "uuid",
  "balanceAfterMinor": 4900,
  "metadata": {}
}
```

---

### `payments` — Telebirr

Requires `Authorization: Bearer <accessToken>`.

#### `POST /payments/telebirr/receipts`

Submit a Telebirr receipt to top up the wallet.

| | |
|---|---|
| Auth | Bearer JWT |
| Body | `{ receiptNo?: string, receiptUrl?: string }` — at least one required |

`receiptNo` must match `^[A-Za-z0-9_-]{4,80}$`.
`receiptUrl` must have hostname `transactioninfo.ethiotelecom.et`.

**Response 201**
```json
{
  "id": "665f...",
  "receiptNo": "ADQ123456",
  "amountMinor": 50000,
  "currencyCode": "CREDIT",
  "status": "credited",
  "parsedReceipt": { ... },
  "verification": { "receiverNameMatched": true, "receiverAccountMatched": true, "transactionStatusAccepted": true }
}
```

**Errors:** 400 (invalid receipt / failed verification), 409 (receipt already used by another user), 503 (Telebirr unreachable)

---

### `keno` — Keno (player)

#### `GET /keno/config`

Returns the active Keno configuration (public).

#### `POST /keno/tickets` — requires Bearer JWT + `Idempotency-Key` header

Purchase a Keno ticket against the current open draw.

| | |
|---|---|
| Auth | Bearer JWT |
| Headers | `Idempotency-Key: <uuid>` (required) |
| Body | `{ selectedNumbers: number[] }` |

**Response 201**
```json
{
  "id": "665f...",
  "drawId": "665f...",
  "selectedNumbers": [3, 17, 42],
  "stakeMinor": 100,
  "matches": 0,
  "payoutMinor": 0,
  "status": "pending",
  "settlementStatus": "pending",
  "configVersion": 1
}
```

**Errors:** 400 (invalid numbers), 404 (no active config), 409 (insufficient balance)

#### `GET /keno/tickets?limit=50` — Bearer JWT

List the authenticated user's tickets, newest first.

#### `GET /keno/tickets/:id` — Bearer JWT

Get a single ticket owned by the authenticated user.

#### `GET /keno/draws?limit=50`

List draws (public), newest first.

#### `GET /keno/draws/:id`

Get a single draw by ID (public).

---

### `admin-keno` — Keno (admin)

All endpoints require `Authorization: Bearer <accessToken>` with role `admin`.

| Method | Path | Action |
|---|---|---|
| `POST` | `/admin/keno/configs` | Create a new Keno config (deactivates current) |
| `GET` | `/admin/keno/configs` | List all configs |
| `POST` | `/admin/keno/draws/execute-next` | Execute the oldest open draw |
| `POST` | `/admin/keno/draws/:id/execute` | Execute a specific draw |
| `POST` | `/admin/keno/draws/:id/cancel` | Cancel a draw and refund all tickets |

---

### `bingo` — Bingo (player)

#### `GET /bingo/rooms`

List all rooms (public), newest first.

#### `GET /bingo/rooms/:id/state`

Get room state. If a valid Bearer JWT is present, also returns the caller's tickets for that room.

#### `POST /bingo/rooms/:id/tickets` — Bearer JWT + `Idempotency-Key`

Purchase one or more tickets for an open room.

| | |
|---|---|
| Auth | Bearer JWT |
| Headers | `Idempotency-Key: <uuid>` (required) |
| Body | `{ count: number }` — 1–24 |

**Response 201** — array of ticket objects

**Errors:** 400 (invalid count), 404 (room not found), 409 (room not open / ticket limit exceeded / insufficient balance)

---

### `admin-bingo` — Bingo (admin)

All endpoints require `Authorization: Bearer <accessToken>` with role `admin`.

| Method | Path | Action |
|---|---|---|
| `POST` | `/admin/bingo/rooms` | Create a new Bingo room |
| `POST` | `/admin/bingo/rooms/:id/draw-next` | Draw the next number |
| `POST` | `/admin/bingo/rooms/:id/cancel` | Cancel room and refund all pending tickets |

---

### `health`

#### `GET /health`

Returns `{ "status": "ok" }` when the application and MongoDB are healthy. Public, no auth.

---

## 5. Authentication & Authorization

### Telegram Mini App login flow

```
Client                          API                         MongoDB
  │                              │                              │
  │  POST /auth/telegram/miniapp │                              │
  │  { initData }                │                              │
  │─────────────────────────────▶│                              │
  │                              │ 1. URL-decode initData       │
  │                              │ 2. Extract & remove hash     │
  │                              │ 3. Sort params, join as      │
  │                              │    "key=value\n" lines       │
  │                              │ 4. secret = HMAC-SHA256(     │
  │                              │    "WebAppData", botToken)   │
  │                              │ 5. calc = HMAC-SHA256(       │
  │                              │    secret, dataCheckString)  │
  │                              │ 6. timingSafeEqual(calc,hash)│
  │                              │ 7. Check auth_date freshness │
  │                              │    (max age: 86400 s)        │
  │                              │                              │
  │                              │──── BEGIN TRANSACTION ──────▶│
  │                              │ 8. Upsert User + AuthIdentity│
  │                              │ 9. ensureDefaultWallet       │
  │                              │ 10. Create RefreshSession    │
  │                              │     (store SHA-256 of token) │
  │                              │◀─── COMMIT ─────────────────│
  │                              │                              │
  │◀─────────────────────────────│                              │
  │  { accessToken, refreshToken,│                              │
  │    tokenType, expiresIn,user}│                              │
```

### JWT payload

```json
{
  "sub": "665f...",
  "roles": ["player"],
  "sessionId": "uuid-of-refresh-session"
}
```

`sessionId` is always present. `sub` is the MongoDB `User._id`.

### Guards

**`JwtAuthGuard`** — validates the `Authorization: Bearer <token>` header, decodes the JWT, and populates `request.user` with `{ id, roles, sessionId }`. Returns HTTP 401 on failure.

**`RolesGuard`** — reads the `@Roles('admin')` decorator metadata and checks `request.user.roles`. Returns HTTP 403 if the required role is absent. Must always be applied **after** `JwtAuthGuard`.

### `AUTH_MODE`

| Value | Active endpoints |
|---|---|
| `telegram_only` | `POST /auth/telegram/miniapp` only |
| `standalone` | `POST /auth/login` (password) only |
| `hybrid` | Both endpoints active |

Default: `hybrid` (as set in `.env.example`).

### Refresh token security

Raw refresh tokens are **never stored**. Only the SHA-256 hex digest is persisted in `refresh_sessions.refreshTokenHash`. The TTL index on `expiresAt` with `expireAfterSeconds: 0` causes MongoDB to automatically delete expired session documents.

---

## 6. Wallet & Ledger System

### Design principles

- Every balance change goes through `WalletService` — never direct Mongoose updates.
- Every `WalletService` call creates an immutable `LedgerEntry` and an `IdempotencyRecord`.
- All mutations run inside a MongoDB multi-document transaction.
- Ledger entries are **append-only**. Corrections use `entryType: "reversal"` or `"adjustment"`.

### `WalletService` public API

| Method | Transaction ownership | Use case |
|---|---|---|
| `debit(input)` | Opens its own session + transaction | Standalone debit (not part of a larger tx) |
| `credit(input)` | Opens its own session + transaction | Standalone credit |
| `debitInSession(input, session)` | Joins caller's session, does not commit | Inside a game or payment transaction |
| `creditInSession(input, session)` | Joins caller's session, does not commit | Inside a game or payment transaction |
| `ensureDefaultWallet(userId, session)` | Joins caller's session | Called during login to create wallet if absent |

### Wallet mutation flow (inside a transaction)

```
1. Look up IdempotencyRecord by (key, userId, action)
   ├── status = "completed"  →  return cached response (idempotent replay)
   └── status = "pending"    →  throw 409 (in-flight duplicate)

2. Create IdempotencyRecord { status: "pending" }

3. Load Wallet
   ├── not found             →  throw 404
   ├── status ≠ "active"     →  throw 409
   └── debit + availableMinor < amount  →  throw 409 (insufficient balance)

4. Update wallet.availableMinor  (+amount for credit, -amount for debit)

5. Create LedgerEntry (append-only)

6. Update IdempotencyRecord { status: "completed", response: result }

7. Return WalletMutationResult
```

### `WalletMutationInput` fields

| Field | Type | Notes |
|---|---|---|
| `userId` | string | |
| `amountMinor` | number | positive integer |
| `entryType` | LedgerEntryType | `stake` \| `win` \| `refund` \| `deposit` \| etc. |
| `sourceType` | string | e.g. `keno_ticket` |
| `sourceId` | string | ID of the source document |
| `idempotencyKey` | string | client-supplied, unique per operation |
| `metadata` | object | optional context |

### Idempotency key conventions

| Operation | Key format |
|---|---|
| Keno ticket purchase | `keno-ticket:<clientIdempotencyKey>` |
| Keno settlement | `keno-settlement:<ticketId>` |
| Keno refund | `keno-refund:<ticketId>` |
| Bingo ticket purchase (per ticket) | `bingo-ticket:<clientIdempotencyKey>:<index>` |
| Bingo tier settlement | `bingo-settlement:<tier>:<ticketId>` |
| Bingo refund | `bingo-refund:<ticketId>` |
| Telebirr deposit | `telebirr:<receiptNo>` |

---

## 7. Payment Flow — Telebirr

### Step-by-step deposit flow

```
POST /payments/telebirr/receipts
{ receiptNo?: string, receiptUrl?: string }

1. Validate input
   ├── Both absent → 400
   ├── receiptNo: must match ^[A-Za-z0-9_-]{4,80}$
   └── receiptUrl: hostname must be transactioninfo.ethiotelecom.et
                   receipt number = last non-empty path segment

2. Fetch receipt HTML from Telebirr
   └── failure → 503 ServiceUnavailable

3. Parse HTML → ParsedTelebirrReceipt

4. Verify transaction status
   └── accepted values (case-insensitive substring match):
       "completed", "success", "successful", "paid"
   └── no match → 400

5. Check receiver (if env vars are set)
   ├── TELEBIRR_EXPECTED_RECEIVER_NAME set →
   │   normalize(parsedReceipt.credited_party_name) must equal normalize(expected)
   └── TELEBIRR_EXPECTED_RECEIVER_ACCOUNT set →
       normalize(parsedReceipt.credited_party_acc_no) must equal normalize(expected)
   └── mismatch → 400
   (normalize = collapse whitespace, lowercase)

6. Convert amount
   amountBirr = parsedReceipt.settled_amount ?? parsedReceipt.total_amount
   amountMinor = Math.round(amountBirr × TELEBIRR_CREDIT_MINOR_PER_BIRR)
   └── not a positive safe integer → 400

7. BEGIN TRANSACTION
   ├── Find TelebirrDeposit by receiptNo
   │   ├── found + same userId   → return cached response (idempotent)
   │   └── found + diff userId   → 409 Conflict
   │
   ├── Create TelebirrDeposit { status: "credited", ... }
   │
   ├── WalletService.creditInSession({
   │     entryType: "deposit",
   │     idempotencyKey: "telebirr:<receiptNo>"
   │   })
   │
   ├── Save walletCredit on deposit document
   └── COMMIT
```

### Amount conversion

```
TELEBIRR_CREDIT_MINOR_PER_BIRR = 100  (default)

500 Birr → Math.round(500 × 100) = 50,000 minor units
```

### Receiver validation

Setting `TELEBIRR_EXPECTED_RECEIVER_NAME` or `TELEBIRR_EXPECTED_RECEIVER_ACCOUNT` to an **empty string** has the same effect as not setting them — the check is silently skipped. This is a production misconfiguration risk if receiver validation was intended.

---

## 8. Keno Game Flow

### Lifecycle

```
Admin creates KenoConfig
        │
        ▼
  Draw auto-created on first ticket purchase (status: open)
        │
        ▼
  Players purchase tickets  ──────────────────────────────┐
        │                                                  │
        ▼                                                  │
  Admin: POST /admin/keno/draws/:id/execute                │
        │                                                  │
        ├── 1. status → "locked"  (no more ticket sales)  │
        ├── 2. RNG draws N numbers from [numberMin, numberMax]
        ├── 3. status → "drawn"                           │
        ├── 4. Settle all pending tickets                 │
        │      (match count → paytable lookup → credit)   │
        └── 5. status → "settled"                         │
                                                          │
  OR: POST /admin/keno/draws/:id/cancel  ◀────────────────┘
        └── Refund all pending tickets, status → "cancelled"
```

### Config management

Creating a new `KenoConfig` atomically sets `status: "inactive"` on all existing configs before activating the new one. Only one config can be `active` at a time. The `version` field auto-increments.

### Ticket purchase validation

All four rules must pass or the request is rejected with HTTP 400 (no ticket or wallet debit is created):

1. `selectedNumbers` must all be unique integers
2. Each number must satisfy `numberMin ≤ n ≤ numberMax`
3. `selectedNumbers.length` must be a value in `allowedSpots`
4. The draw must be in `open` status

### Payout calculation

```
payout = stakeMinor × payoutMultiplier

payoutMultiplier is looked up from paytable by (spots, matchCount).
If no entry matches → multiplier = 0 (no win).
ticket.status = payoutMinor > 0 ? "won" : "lost"
```

### Default paytable (spots 1–12)

| Spots | Matches | Multiplier |
|---|---|---|
| 1 | 1 | 3× |
| 2 | 2 | 12× |
| 3 | 2 | 2× |
| 3 | 3 | 45× |
| 4 | 2 | 1× |
| 4 | 3 | 8× |
| 4 | 4 | 120× |
| 5 | 3 | 3× |
| 5 | 4 | 25× |
| 5 | 5 | 800× |
| 6 | 3 | 1× |
| 6 | 4 | 12× |
| 6 | 5 | 150× |
| 6 | 6 | 1,600× |
| 7 | 4 | 5× |
| 7 | 5 | 50× |
| 7 | 6 | 400× |
| 7 | 7 | 7,000× |
| 8 | 5 | 20× |
| 8 | 6 | 200× |
| 8 | 7 | 2,000× |
| 8 | 8 | 10,000× |
| 9 | 5 | 5× |
| 9 | 6 | 50× |
| 9 | 7 | 500× |
| 9 | 8 | 5,000× |
| 9 | 9 | 20,000× |
| 10 | 5 | 2× |
| 10 | 6 | 25× |
| 10 | 7 | 250× |
| 10 | 8 | 2,500× |
| 10 | 9 | 10,000× |
| 10 | 10 | 50,000× |
| 11 | 6 | 10× |
| 11 | 7 | 100× |
| 11 | 8 | 1,000× |
| 11 | 9 | 8,000× |
| 11 | 10 | 25,000× |
| 11 | 11 | 75,000× |
| 12 | 6 | 5× |
| 12 | 7 | 50× |
| 12 | 8 | 500× |
| 12 | 9 | 5,000× |
| 12 | 10 | 20,000× |
| 12 | 11 | 50,000× |
| 12 | 12 | 100,000× |

### Cancellation

```
POST /admin/keno/draws/:id/cancel

For each ticket where settlementStatus = "pending":
  ticket.status           = "cancelled"
  ticket.settlementStatus = "settled"
  ticket.payoutMinor      = 0
  WalletService.creditInSession({ entryType: "refund" })

draw.status = "cancelled"
```

Cancelling an already-`settled` draw returns HTTP 409.

---

## 9. Bingo Game Flow

### Lifecycle

```
Admin: POST /admin/bingo/rooms  (status: open)
        │
        ▼
  Players purchase tickets (1–24 per request)
        │
        ▼
  Admin: POST /admin/bingo/rooms/:id/draw-next  (status → running on first call)
        │  ┌─────────────────────────────────────────────────────────┐
        │  │  RNG draws 1 number from remaining pool                 │
        │  │  Evaluate all active tickets for completed prize tiers  │
        │  │  Settle newly completed tiers (first-to-complete wins)  │
        │  │  If full_house settled → status = "completed"           │
        │  └─────────────────────────────────────────────────────────┘
        │  (repeat until full_house or admin cancels)
        │
        ▼
  OR: POST /admin/bingo/rooms/:id/cancel
        └── Refund all pending tickets, status → "cancelled"
```

### 90-ball ticket structure

```
Grid: 3 rows × 9 columns, 15 numbers total, exactly 5 per row

Column ranges:
  col 0: 1–9    col 1: 10–19   col 2: 20–29
  col 3: 30–39  col 4: 40–49   col 5: 50–59
  col 6: 60–69  col 7: 70–79   col 8: 80–90

Each column has 1–3 numbers, sorted ascending top-down.
Empty cells are null.

Example:
  [ 5,  null, 23,  null, 41,  null, 63,  null, 88 ]
  [ null, 14, null, 37,  null, 52,  null, 71,  null]
  [ 9,  null, 28,  null, 49,  null, 67,  null, 90 ]
```

### Prize tiers

| Tier | Condition | Settles |
|---|---|---|
| `one_line` | Any 1 complete row marked | Once per room |
| `two_lines` | Any 2 complete rows marked | Once per room |
| `full_house` | All 3 rows marked | Once per room → room completes |

Each tier settles **exactly once per room**. The first ticket(s) to complete a tier win. Later completions of the same tier in the same room receive no prize.

### Prize splitting

```
shares = splitPrizeMinor(prizeMinor, winnerCount)

baseShare = Math.floor(prizeMinor / winnerCount)
remainder = prizeMinor % winnerCount

Winners sorted by createdAt ascending (earliest purchasers first).
First `remainder` winners receive baseShare + 1.
Remaining winners receive baseShare.
```

### Ticket purchase idempotency

`purchaseIdempotencyKey` is stored on each ticket. A repeated `Idempotency-Key` header for the same `(roomId, userId)` returns the existing tickets without creating duplicates or re-debiting the wallet.

### Cancellation

```
POST /admin/bingo/rooms/:id/cancel

For each ticket where settlementStatus = "pending":
  ticket.status           = "cancelled"
  ticket.settlementStatus = "settled"
  WalletService.creditInSession({ entryType: "refund" })

room.status = "cancelled"
```

Cancelling an already-`cancelled` room is a no-op (idempotent). Cancelling a `completed` room returns HTTP 409.

---

## 10. RNG Service

### Algorithm

**Fisher-Yates draw-without-replacement** using Node.js `crypto.randomInt(min, max)` for each selection step.

Algorithm version string: `crypto-random-int-without-replacement-v1`

`Math.random()` is **prohibited** for all game outcomes. All draws must go through `RngService.drawUniqueNumbers`.

### `drawUniqueNumbers` input

```typescript
{
  min: number,          // range start (inclusive)
  max: number,          // range end (inclusive)
  count: number,        // how many unique numbers to draw
  gameType?: 'keno' | 'bingo',
  gameReference?: string,   // draw ID or "roomId:callIndex"
  metadata?: object,
  session?: ClientSession
}
```

If both `gameType` and `gameReference` are provided, an `RngAuditLog` is created and its `_id` is returned as `auditLogId`. If only one is provided, the call is rejected with an error.

### Audit log hashes

**`inputHash`** — SHA-256 of the stable-JSON-serialized input parameters. Keys sorted lexicographically, no whitespace. Covers exactly: `algorithmVersion`, `count`, `gameReference`, `gameType`, `max`, `min`.

**`randomnessMaterialHash`** — SHA-256 of exactly **32 random bytes** generated via `crypto.randomBytes(32)` per draw. The 32-byte count is a correctness requirement of the audit trail.

Both hashes allow independent verification that the draw inputs and randomness source were not tampered with.

### How Keno uses RNG

```typescript
rngService.drawUniqueNumbers({
  min: config.numberMin,   // 1
  max: config.numberMax,   // 80
  count: config.drawSize,  // 20
  gameType: 'keno',
  gameReference: draw._id.toString()
})
// → 20 unique numbers from 1–80
```

### How Bingo uses RNG

Each `draw-next` call draws **1 number** from the remaining pool:

```typescript
rngService.drawUniqueNumbers({
  min: 1,
  max: remainingNumbers.length,  // shrinks each call
  count: 1,
  gameType: 'bingo',
  gameReference: `${roomId}:${callIndex}`,
  metadata: { remainingNumbers }
})
// result.numbers[0] is an index into remainingNumbers
drawnNumber = remainingNumbers[result.numbers[0] - 1]
```

---

## 11. Configuration & Environment

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test` |
| `PORT` | No | `3000` | HTTP listen port |
| `MONGODB_URI` | **Yes** | — | Must point to a replica set (e.g. `?replicaSet=rs0`) |
| `JWT_ACCESS_SECRET` | **Yes** | — | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | **Yes** | — | Secret for signing refresh tokens |
| `JWT_ACCESS_TTL` | No | `15m` | Access token TTL (e.g. `15m`, `1h`) |
| `JWT_REFRESH_TTL` | No | `30d` | Refresh token TTL |
| `TELEGRAM_BOT_TOKEN` | **Yes** | — | Required for `telegram_only` or `hybrid` auth |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | No | `86400` | Max age of Telegram `auth_date` (seconds) |
| `AUTH_MODE` | No | `hybrid` | `telegram_only` \| `standalone` \| `hybrid` |
| `TELEBIRR_EXPECTED_RECEIVER_NAME` | No | `""` | If set, receipt receiver name must match |
| `TELEBIRR_EXPECTED_RECEIVER_ACCOUNT` | No | `""` | If set, receipt receiver account must match |
| `TELEBIRR_CREDIT_MINOR_PER_BIRR` | No | `100` | Conversion factor: 1 Birr = N minor units |

### JWT TTL format

A positive integer followed by a unit suffix: `s` (seconds), `m` (minutes), `h` (hours), `d` (days).

Examples: `15m`, `1h`, `7d`, `30d`

### MongoDB replica set requirement

`WalletService`, `KenoService`, and `BingoService` use multi-document transactions. MongoDB requires replica set mode for transactions. The connection string must include `?replicaSet=rs0` (or equivalent).

### Telebirr receiver validation caveat

Setting `TELEBIRR_EXPECTED_RECEIVER_NAME` or `TELEBIRR_EXPECTED_RECEIVER_ACCOUNT` to an **empty string** silently skips the check — same as not setting them. If receiver validation is required in production, ensure these variables are set to non-empty values.

---

## 12. Local Development & Docker

### Prerequisites

- Node.js 20+
- Docker + Docker Compose

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in required values

# 3. Start MongoDB (replica set)
docker compose up -d

# 4. Start the API in watch mode
npm run start:dev
```

### Docker Compose — MongoDB service

```yaml
services:
  mongo:
    image: mongo:7
    container_name: igames-mongo
    command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval",
             "try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0', members:[{_id:0, host:'localhost:27017'}]}).ok }"]
      interval: 10s
      timeout: 5s
      retries: 10
```

The healthcheck initializes the `rs0` replica set on first startup. Subsequent runs detect an already-initialized set and return `ok`.

### npm scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm run start:dev` | Watch mode with hot reload |
| `npm run start:prod` | Production start |
| `npm run format` | Prettier formatting |
| `npm run lint` | ESLint |
| `npm test` | Jest (single run) |
| `npm run test:watch` | Jest watch mode |
| `npm run test:cov` | Jest with coverage report |

### Verification

```bash
npm run build                    # must exit 0
npm run lint                     # must exit 0
npm test -- --passWithNoTests    # must exit 0
```

### Useful URLs (local)

| URL | Description |
|---|---|
| `http://localhost:3000/docs` | Swagger / OpenAPI UI |
| `http://localhost:3000/health` | Liveness check → `{ "status": "ok" }` |
| `mongodb://localhost:27017/igames?replicaSet=rs0` | MongoDB connection string |
