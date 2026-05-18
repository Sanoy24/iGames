# Project Structure

The iGames Framework enforces a strict modular domain-driven architecture. The core principle is that modules must remain highly cohesive and loosely coupled.

## Root Overview

```text
├── src/
│   ├── admin/       # Management APIs and Configuration
│   ├── auth/        # Telegram Auth & Guards
│   ├── bingo/       # Bingo Game Engine & Schedulers
│   ├── bots/        # Simulated Player Behaviors
│   ├── events/      # Socket.io Gateway
│   ├── keno/        # Keno Game Engine
│   ├── ledger/      # Idempotency & Financial Logs
│   ├── payments/    # Telebirr Integration
│   ├── rng/         # HMAC-DRBG Security
│   ├── scheduler/   # Background CRON Tasks
│   ├── users/       # Identity & Accounts
│   └── wallet/      # Financial Balances & Mutations
├── frontend/        # React + Zustand Mini-App
├── package.json
└── docs-site/       # VitePress Documentation (You are here)
```

## Key Modules Explained

### `wallet` & `ledger`
These modules form the financial backbone. **No other module** is permitted to modify a user's balance directly. All financial transactions must proxy through `WalletService.debitInSession` or `WalletService.creditInSession`, which orchestrate strictly with the `LedgerService` to guarantee idempotent execution.

### `events`
Houses `GameEventsGateway`. This single WebSocket hub utilizes `@socket.io/redis-adapter` to blast live state updates (like new Bingo numbers or Wallet credits) across horizontal scaling boundaries.

### `rng`
The `RngService` is a specialized, locked-down service that uses deterministic cryptographic derivation. Games pass their seed materials here, and `rng` spits out provably fair numbers along with audit logs.
