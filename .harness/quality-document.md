# iGames Codebase Quality Document

> Module-by-module health tracker. Updated periodically (aim: weekly or after major sessions).
> Grades: A = excellent, B = good, C = needs attention, D = blocking tech debt.
> Dimensions: V=Verification, U=Agent-Understandable, T=Test-Stability, A=Architecture-Compliance, C=Code-Conventions.

Last updated: 2026-06-29

---

## Backend Modules

| Module | V | U | T | A | C | Notes |
|---|---|---|---|---|---|---|
| auth | A | A | B | A | A | JWT + Telegram both work. Missing integration tests for refresh flow. |
| wallet | A | A | B | A | A | Idempotency enforced. Need integration test for double-debit guard. |
| ledger | A | A | B | A | A | Immutable by design. Tests exist for basic credit/debit. |
| keno | A | A | B | A | A | Draw lifecycle + settlement clean. PATCH numbers endpoint added. |
| bingo | B | A | C | A | A | Self-healing guard added. Scheduler perf fixed. Need more e2e coverage. |
| crash | B | B | C | B | A | Stale round fix on bootstrap works. RNG fix applied. Needs integration tests. |
| rng | A | A | A | A | A | Audit logs complete. Deterministic tests. |
| payments | B | B | C | A | A | Telebirr ingestion works. No test coverage. |
| telegram | B | B | C | A | A | Grammy bot works. Auth validated. No automated tests. |
| admin | A | B | B | A | A | All endpoints working. Stats endpoints could use more granular data. |
| events | B | B | C | A | A | Live counts heartbeat added. No socket event tests. |
| scheduler | B | A | C | A | A | Bingo EVERY_SECOND scheduler stable. Crash bootstrap clean. |
| common | A | A | A | A | A | Guards, pipes, interceptors well-documented. |
| users | A | A | B | A | A | Agent creation + profile clean. |

---

## Frontend Pages

| Page | V | U | T | A | C | Notes |
|---|---|---|---|---|---|---|
| App.tsx | A | A | C | A | A | Auth bootstrap solid. No unit tests. |
| Home | B | A | C | A | A | Live counts working. Socket reconnect tested manually. |
| Keno | A | A | C | A | A | Pay-first flow complete. Win modal added. Tabs added. No tests. |
| Bingo | A | A | C | A | A | Phase machine (buy/playing/result) complete. No tests. |
| Crash | B | B | C | B | B | Works but RNG fix was needed. UI could be more informative. |
| Wallet | B | A | C | A | A | Ledger history shows. Withdrawal flow untested. |
| Admin | B | B | C | B | B | Visual overhaul done. Per-tab bespoke layouts not yet done (FE-09). |
| Agent | B | B | C | A | A | Claim/process withdrawals works. Basic layout. |
| Profile | C | B | C | B | B | Basic page. Stats/history not implemented (FE-10). |

---

## Architecture Layers

| Layer | Grade | Notes |
|---|---|---|
| Domain rules (CLAUDE.md) | A | Non-negotiables documented and enforced |
| Agent guide (AGENTS.md) | A | Navigation, commands, patterns all documented |
| API contracts (OpenAPI decorators) | B | Most endpoints decorated; some gaps in crash module |
| Database integrity (indexes, transactions) | A | Replica set required; all mutations transactional |
| Security (guards, rate limiting, validation) | A | DTOs, guards, throttle in place |
| Observability (audit logs, request IDs) | B | Auth/wallet/RNG audited; game events less structured |
| Test coverage | C | Unit tests for game math; missing integration and e2e |
| State management (harness files) | A | feature_list.json, PROGRESS.md, DECISIONS.md now in place |

---

## Entropy Watch

> Items accumulating technical debt

| Item | Severity | Action |
|---|---|---|
| Missing e2e tests | Medium | Lecture 10: E2E testing changes results. Add Playwright or Supertest e2e. |
| Socket event test coverage | Low | Add Jest mock socket tests for game events gateway. |
| Admin per-tab layouts | Low | FE-09: cosmetic but affects operator UX |
| MySQL ROW_FORMAT migration | High | Must run on production or DB operations may fail |
| Crash module integration tests | Medium | Service restart fix untested automatically |

---

## Harness Subsystem Health (from Lecture 02)

| Subsystem | Health | Notes |
|---|---|---|
| Instruction (CLAUDE.md + AGENTS.md) | ✅ Strong | Comprehensive, split across two focused files |
| Tool (dev commands, verification) | ✅ Strong | All commands in AGENTS.md + feature_list.json |
| Environment (.nvmrc, package.json, Dockerfile) | ✅ Good | Dockerfile present; no .nvmrc (add Node 20 pin) |
| State (PROGRESS.md, feature_list.json, DECISIONS.md) | ✅ New | Added this session — first use will validate |
| Feedback (tsc, build, unit tests) | ✅ Good | Commands explicit in AGENTS.md |
