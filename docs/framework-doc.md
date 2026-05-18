# iGames Platform Documentation

## Overview

iGames is a high-performance, real-time developer platform and backend framework designed specifically for lottery-style games, notably **Keno** and **90-Ball Bingo**. 

Built entirely in TypeScript using **NestJS** and **React**, the framework emphasizes modularity, horizontal scalability, and event-driven architecture. 

### Main Purpose
To provide a turnkey, scalable backend architecture for Telegram Mini-App integrated gaming, complete with deterministic RNG (Random Number Generation), robust ledgering, real-time socket-based synchronization, and automated cron scheduling.

### Core Concepts
- **Deterministic Draws**: Every game execution is synchronized through scheduled configurations and idempotent transactional constraints.
- **Event-Driven Gameplay**: Real-time updates emitted through Socket.IO with a Redis adapter for cluster awareness.
- **Transactional Ledger**: All wallet actions (stakes, payouts, refunds) are handled as double-entry ledger items inside Mongoose transactions.
- **Automated Participation (Bots)**: System-managed bot entities that programmatically participate in draws, simulating active user bases and enforcing game liveliness.

### Key Features
- **Horizontally Scalable Sockets**: Utilizing Redis pub/sub (`@socket.io/redis-adapter`), game events are instantly propagated across all backend instances.
- **Telebirr Integration**: Built-in flow for Ethiopian Birr transactions (`telebirr-receipt`).
- **Telegram Mini-App Native**: Seamless login through Telegram's `initData` via the `grammy` framework.
- **Job Scheduling Ecosystem**: Fully automated game progression (ticket opening, countdowns, RNG draws, settlement, and orphaned game reaping).

### Architecture Overview
The platform utilizes a modular monolith architectural pattern. NestJS serves as the API and WebSockets server, backed by **MongoDB (Mongoose)** for persistence and **Redis (ioredis)** for distributed pub/sub and lock management. A **Vite + React** frontend interfaces with the core platform via REST controllers and a unified Socket connection.

---

## Getting Started

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd iGames

# Install dependencies (Backend)
npm install

# Install dependencies (Frontend)
cd frontend
npm install
```

### Requirements
- Node.js (v20+ recommended)
- MongoDB (v6.0+)
- Redis (v7.0+)

### Environment Setup
Create a `.env` file in the backend root based on `.env.example`:
```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/igames
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_ACCESS_SECRET=your_jwt_secret
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_ORIGIN=http://localhost:5173
```

### Configuration
System configurations for Keno (paytables, intervals, bot intervals) are stored in the database dynamically. 

### Quick Start Example
```bash
# 1. Start MongoDB and Redis (or use docker-compose)
docker-compose -f docker-compose.dev.yml up -d

# 2. Start the backend in development mode
npm run start:dev

# 3. Start the Vite frontend
cd frontend
npm run dev
```

---

## Project Structure

```text
├── src/
│   ├── admin/      # Administrative APIs (Game configs, User states)
│   ├── auth/       # JWT Auth and Telegram InitData Validation
│   ├── bingo/      # 90-ball Bingo Core Domain
│   ├── bots/       # Automated Player Emulation System
│   ├── common/     # Global Exceptions, Middlewares, and DTOs
│   ├── config/     # Environment Validation
│   ├── events/     # Real-time WebSockets (GameEventsGateway)
│   ├── keno/       # Keno Core Domain & Rules Engine
│   ├── ledger/     # Transactional History & Audit
│   ├── payments/   # Telebirr Receipt Verification
│   ├── redis/      # Distributed State & Caching
│   ├── rng/        # Random Number Generation Engine
│   ├── scheduler/  # Cron jobs for automated game progression
│   ├── telegram/   # Telegram Bot configuration
│   ├── users/      # Player Profile Management
│   └── wallet/     # Double-Entry Wallet Ledger
├── frontend/       # React SPA (Vite, Zustand)
```

### Dependency Relationships
- **WalletModule** acts as the single source of truth for balances; both **KenoModule** and **BingoModule** depend on it heavily.
- **EventsModule** depends on **RedisModule** to propagate socket messages.
- **SchedulerModule** orchestrates **Keno** and **Bingo** state machines independently.

---

## Core Architecture

### System Design
A state-machine driven approach. Game instances (e.g., Keno Draws, Bingo Rooms) transition through strict statuses: `open` -> `locked` -> `drawn` -> `settled` (or `cancelled`).

### Request Flow
1. Client HTTP request hits standard NestJS REST Controller.
2. `ThrottlerGuard` applies rate limiting.
3. Authenticated requests pass through JWT extraction.
4. Services wrap operations in MongoDB `ClientSession.withTransaction()`.

### Event Flow
1. Game state changes inside `KenoService` or `BingoService`.
2. Changes are explicitly pushed to `GameEventsGateway` (e.g., `emitKenoDrawCompleted`).
3. Gateway dispatches Socket.IO message.
4. If multiple Node instances run, the Redis adapter multicasts the payload so clients connected to any node receive the push.

### State Management
Backend state is strictly ephemeral or persisted in MongoDB.
Frontend state is synchronized via `zustand` (e.g., `useStore`), updating automatically via Socket event listeners (`socket.on('keno.draw.completed', ...)`).

---

## API Reference

### Public APIs
*(Auto-generated via Swagger at `/docs` in development)*

- `POST /auth/telegram/miniapp`: Validate Telegram payload and yield JWT.
- `GET /wallet`: Retrieve current balance.
- `POST /keno/tickets`: Purchase Keno ticket (Requires `Idempotency-Key` header).
- `GET /keno/draws`: List recent/upcoming draws.

### Core Services

#### `KenoService`
- **Purpose**: Manage Keno configurations, draw lifecycles, and ticket purchasing.
- **Example Method**: `executeDraw(drawId: string)`
  - **Parameters**: `drawId` (MongoDB ObjectId).
  - **Behavior**: Locks draw, calculates forced wins, triggers `RngService`, settles tickets.
  - **Error Handling**: Throws `ConflictException` if draw is not 'open'.

#### `WalletService`
- **Purpose**: Strictly ACID-compliant wallet balances.
- **Example Method**: `debitInSession(payload, session)`
  - **Behavior**: Decrements user balance and writes a `LedgerEntry` simultaneously. Relies entirely on the provided Mongoose `ClientSession`.

---

## Developer Guide

### How to extend the framework
To add a new game (e.g., Slots):
1. Create a new NestJS module (`slots.module.ts`).
2. Add your state logic and define an immutable Mongoose Schema (`SlotSpin`).
3. Connect `WalletService` to handle stakes and payouts within a transaction.
4. Emit results via `GameEventsGateway`.

### Best Practices & Conventions
- **Always Use Idempotency Keys**: Whenever creating financial transactions, pass a unique idempotency key to prevent double billing.
- **Transaction Wrappers**: Game settlements and ticket purchases must use `session.withTransaction()` to ensure atomicity.
- **Decoupled RNG**: Never calculate random outcomes inside the core service. Delegate to `RngService`.

---

## Authentication & Security

- **Auth Flow**: The client retrieves `initData` from the Telegram WebApp. The backend validates the HMAC signature using the `TELEGRAM_BOT_TOKEN`. A short-lived JWT is issued.
- **Middleware**: `RequestIdMiddleware` assigns tracking UUIDs to all HTTP calls.
- **Security Considerations**: `helmet` is enabled globally. Socket.io implements JWT checks during connection handshakes.

---

## Database Layer

- **Models**: Built using `@nestjs/mongoose` (`@Schema`, `@Prop`).
- **Relationships**: Weakly referenced via `ObjectId` strings (`userId`, `drawId`) to reduce aggressive populating and prioritize isolated queries.
- **Transactions**: Employs Replica-set transactional requirements. Development environments must run MongoDB as a single-node replica set for transactions to work.

---

## Background Jobs / Queues

- **Architecture**: In-process scheduling via `@nestjs/schedule`.
- **Workers**: 
  - `KenoScheduler`: Executes draws when their `scheduledAt` timestamp passes.
  - `BingoScheduler`: Emits progressive ball draws and calculates line completions.
  - `ReaperScheduler`: Finds stuck or orphaned games and cancels/refunds them automatically.
  - `BotsScheduler`: Simulates bot player ticket purchases right before draws close.
- **Retry Mechanisms**: `Scheduler` catches and logs errors; it will re-attempt on the next tick interval (usually every few seconds).

---

## Bot / System Automation (AI)

*(Note: "Bots" in this framework refer to deterministic system scripts, not LLMs).*

- **Agent Architecture**: Automated participants are flagged with `productMetadata.botPolicy`.
- **Orchestration**: Before a game closes, `BotsService` queries active bots and purchases tickets.
- **Forced Wins**: Configurable `globalBotWinInterval` forces a bot to pick winning numbers at a statistical interval, maintaining public ledger activity and perceived liquidity.

---

## Examples

### Creating a Custom Keno Configuration via Admin API
```typescript
await adminKenoApi.createConfig({
  name: "Turbo Keno",
  numberMin: 1,
  numberMax: 40,
  drawSize: 10,
  ticketPriceMinor: 50, // 0.50 credits
  autoScheduleIntervalMinutes: 1
});
```

---

## Deployment

### Production Setup
- Requires a managed MongoDB cluster (e.g., MongoDB Atlas).
- Requires a managed Redis instance (e.g., ElastiCache).

### Docker
```yaml
# docker-compose.yml included
version: '3.8'
services:
  api:
    build: .
    environment:
      - NODE_ENV=production
```

### Scaling Considerations
The application is stateless with exception to WebSockets. Because `@socket.io/redis-adapter` is implemented, you can horizontally scale the Node API across multiple containers without losing event broadcasting.

---

## Troubleshooting

### Common Issues
- **"Transaction Numbers" or "MongoError: Transaction numbers are only allowed on a replica set"**:
  - **Fix**: You are running a standalone MongoDB. Transactions require a replica set. Start MongoDB with `--replSet rs0`.

- **WebSockets not connecting**:
  - **Fix**: Ensure CORS `ALLOWED_ORIGIN` matches your Vite preview URL exactly.

### Logging Strategy
- Utilizes `winston`. In production, outputs structured JSON.
- Critical errors are routed to **Sentry** with profiling enabled.

---

## Contributing

1. Create a feature branch off `main`.
2. Follow strict typing; use `type` for Data Transfer structures and `interface` for extensibility.
3. Verify tests: `npm run test:unit`.
4. Run standard linting: `npm run lint` and `npm run format`.
5. Submit PR with detailed breakdown of Schema/Wallet impacts.
