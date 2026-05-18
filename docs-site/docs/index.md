---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "iGames Framework"
  text: "Production-Grade iGaming Platform"
  tagline: Built for Telegram Mini-Apps, engineered for high-concurrency and provable fairness.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View API Reference
      link: /guide/api-reference

features:
  - title: High Concurrency Engine
    details: Atomic ledger interactions, idempotency keys, and sub-millisecond wallet mutations for uninterrupted real-time gaming.
  - title: Telegram First
    details: Seamless Telegram Mini-App integration using WebApp initialization data for zero-click authentication.
  - title: Provably Fair RNG
    details: Built-in HMAC-DRBG secure pseudorandom number generators, ensuring cryptographically verifiable game outcomes.
---

## What is iGames Framework?

iGames Framework is an end-to-end open-source architecture built around **NestJS** and **React** for developing scalable Telegram Casino and Betting Mini-Apps. The framework solves the hardest parts of online betting out-of-the-box:

- **Double-Spend Prevention**: Distributed locking and atomic `$inc` operators.
- **Background Schedulers**: Resilient Keno and Bingo state machines powered by Redis locks.
- **Wallet Ledgers**: Financial-grade idempotency and strict double-entry ledger constraints.
- **WebSocket Synchronization**: Live state syncing using Socket.io and Redis adapters for massive scaling.

It is specifically tailored to comply with Responsible Gaming (RG) requirements and seamlessly integrates with localized payment solutions (like Telebirr).
