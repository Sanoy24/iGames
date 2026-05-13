# iGames

NestJS + MongoDB backend for iGames Keno and 90-ball Bingo.

## Current Backend Status

Implemented foundation:

- NestJS application scaffold with TypeScript.
- MongoDB/Mongoose connection.
- Docker Compose MongoDB replica set for local transactions.
- Health endpoint at `GET /health`.
- Swagger/OpenAPI at `/docs`.
- Request ID middleware and structured HTTP error responses.
- Internal `User`, `AuthIdentity`, `Wallet`, and `RefreshSession` schemas.
- Telegram Mini App auth exchange at `POST /auth/telegram/miniapp`.
- Telegram identity maps to an internal iGames user, then receives first-party iGames JWTs.
- Protected wallet read endpoint at `GET /wallet`.
- Protected ledger history endpoint at `GET /wallet/ledger`.
- Transactional wallet debit/credit service with immutable ledger entries and idempotency records.
- Crypto-backed RNG service for unique draws without replacement.
- RNG audit log schema for Keno/Bingo draw evidence.
- Manual Telebirr wallet top-up flow using `telebirr-receipt`.
- Protected Telebirr receipt submission endpoint at `POST /payments/telebirr/receipts`.
- Complete Keno backend slice with config, ticket purchase, draw execution, RNG audit, and settlement.
- Complete 90-ball Bingo backend slice with rooms, generated tickets, live draws, tier settlement, and refunds.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and replace the secrets:

```bash
cp .env.example .env
```

3. Start MongoDB:

```bash
docker compose up -d
```

4. Start the API:

```bash
npm run start:dev
```

The API runs on `http://localhost:3000` by default.

## Manual Telebirr Top-Ups

Users pay manually through Telebirr, then submit either the receipt number or receipt URL:

```http
POST /payments/telebirr/receipts
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "receiptNo": "ADQ123..."
}
```

The backend loads the official receipt page, parses it with `telebirr-receipt`, checks transaction status and configured receiver details, prevents receipt reuse, and credits the wallet through the ledger.

## Verification

```bash
npm run build
npm run lint
npm test -- --passWithNoTests
```
