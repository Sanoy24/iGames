# iGames Contributor Guide

This repo is building an audit-conscious NestJS + MySQL backend for Keno and 90-ball Bingo. Treat the backend as ledger-ready credits from day one: no real-money payments, KYC, AML, tax, or jurisdiction-specific compliance should be added unless explicitly requested. The first client may be a Telegram Bot and Telegram Mini App, but the backend must remain standalone and saleable as its own product.

## Stack And Shape

- Use NestJS, TypeScript, MySQL (via TypeORM), and Redis.
- Keep module boundaries clear: `auth`, `users`, `telegram`, `wallet`, `ledger`, `keno`, `bingo`, `rng`, `admin`, and `common`.
- Prefer DTOs, services, entities, guards, interceptors, and pipes that match standard NestJS + TypeORM patterns.
- Keep reusable cross-cutting code in `common`, not inside game modules.
- Use OpenAPI decorators for public REST endpoints.
- Keep Telegram integration behind adapter/provider services. Game, wallet, ledger, RNG, and admin modules must not import Telegram bot SDKs directly.

## Non-Negotiable Domain Rules

- Never update a wallet balance without creating an immutable ledger entry in the same TypeORM transaction (`EntityManager`).
- Store all money-like values as integer minor units. Do not use floating-point values for balances, stake amounts, prizes, or payouts.
- Never use `Math.random()` for game outcomes. All game draws must go through the RNG service.
- Game rules, paytables, room settings, ticket prices, and prize values must be database-backed configuration, not hardcoded business values.
- Ticket purchase and settlement must be idempotent. Reusing an idempotency key must not double debit or double credit a wallet.
- Keno numbers are unique values from 1 to 80, with 20 unique numbers drawn per draw.
- The first Bingo implementation is 90-ball Bingo: 3x9 ticket grid, 15 numbers per ticket, numbers drawn from 1 to 90 without replacement, and one-line, two-line, and full-house win tiers.
- A `User` is an internal iGames account. Telegram identity is only one login provider mapped to that internal user.

## Security And API Expectations

- Use DTO validation for all inputs. Reject unknown or malformed payloads early.
- Use guards for authentication, role checks, and admin/system-only actions.
- Use structured error responses; avoid leaking sensitive implementation details.
- For standalone email/password deployments, hash passwords with Argon2id.
- For Telegram Mini App login, validate raw `Telegram.WebApp.initData` on the backend with the bot token, `WebAppData` secret derivation, received hash, and `auth_date` freshness before creating or linking the internal user.
- Use JWT access tokens and refresh tokens after any successful provider authentication, including Telegram.
- Rate-limit auth, ticket purchase, and other abuse-prone endpoints.
- Include request IDs in logs and propagate them through important service calls.

## Audit And Observability

- Log audit records for auth-sensitive events, wallet mutations, ledger writes, admin configuration changes, RNG operations, draw execution, and settlement.
- RNG audit logs should include algorithm version, game reference, draw inputs, output numbers, timestamp, and a hash of randomness material.
- Keep enough RNG and settlement evidence to support internal verification, but do not expose future randomness or exploitable seed material through public APIs.
- Use MySQL unique indexes and status-column guards to protect scheduled jobs from duplicate execution.

## Testing Expectations

- Unit-test game math and validation:
  - Keno spot validation, draw uniqueness, match counting, and payout lookup.
  - 90-ball ticket generation, number placement validity, and one-line/two-line/full-house detection.
- Integration-test wallet behavior:
  - Ticket purchase debits.
  - Winning settlement credits.
  - Failed settlement retry is safe.
  - Duplicate idempotency keys do not double debit or double credit.
- E2E-test the main player paths for auth, wallet, Keno tickets/draws, and Bingo rooms/tickets/draws.

## Implementation Discipline

- Keep changes focused on the requested module or behavior.
- Do not introduce payment gateways, KYC providers, AML flows, or certification claims unless the task explicitly asks for them.
- Do not make Telegram required for core backend behavior. Telegram-specific logic belongs in `telegram` and `auth` provider code only.
- Do not bypass ledger services by mutating wallet rows directly.
- Do not hardcode temporary game odds or prize values into services. Add seed data or config rows instead.
- Prefer readable domain services over clever abstractions. Game correctness and auditability matter more than compact code.
- When adding background jobs, make them restart-safe and retry-safe.

## Useful References

- NestJS TypeORM: https://docs.nestjs.com/techniques/database
- NestJS validation: https://docs.nestjs.com/techniques/validation
- NestJS OpenAPI: https://docs.nestjs.com/openapi/introduction
- TypeORM transactions: https://typeorm.io/transactions
- Telegram Mini Apps: https://core.telegram.org/bots/webapps
- Telegram Login Widget: https://core.telegram.org/bots/telegram-login
- OWASP API Security Top 10: https://owasp.org/API-Security/
- GLI standards library: https://gaminglabs.com/gli-standards/
