# API Reference

The iGames Framework provides a standard REST API over HTTP, coupled with Socket.io for realtime subscriptions.

## Authentication
`POST /auth/telegram/miniapp`
- **Purpose**: Exchange Telegram `initData` for an access token.
- **Body**: `{ "initData": "query_id=...&user=..." }`
- **Response**: `{ "accessToken": "jwt...", "user": {...} }`

## Wallet & Ledger
`GET /wallet`
- **Purpose**: Fetch current user's balance.

`GET /wallet/ledger?limit=20`
- **Purpose**: Fetch the double-entry accounting log for the user.

## Keno
`GET /keno/config`
- **Purpose**: Retrieve active Keno settings (paytables, draw frequency).

`POST /keno/tickets`
- **Purpose**: Place a bet on the upcoming Keno draw.
- **Headers**: `Idempotency-Key` (Required)
- **Body**: `{ "selectedNumbers": [5, 12, 34, 55, 80] }`

`GET /keno/active-draw`
- **Purpose**: Fetch the currently running draw to synchronize live frontend state.

## Bingo
`GET /bingo/rooms`
- **Purpose**: List available Bingo rooms.

`POST /bingo/rooms/:id/tickets`
- **Purpose**: Purchase tickets for a room.
- **Headers**: `Idempotency-Key` (Required)
- **Body**: `{ "count": 2 }`

`GET /bingo/rooms/:id/sync`
- **Purpose**: Hydrate frontend state when returning from app suspension (background mode).

## Admin
Admin routes are strictly guarded by `@Roles('admin')`.

`POST /admin/users/:id/wallet/adjust`
- **Purpose**: Manually adjust a player's balance (used for support/refunds).
- **Body**: `{ "amountMinor": 1000, "direction": "credit", "reason": "Compensation" }`

`GET /admin/stats/overview`
- **Purpose**: Returns `platformstats` including GGR, Total Liabilities, and Volume.
