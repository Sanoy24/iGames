# Evaluator Rubric iGames

> Use this rubric when reviewing agent output at the end of a session or before merging changes.
> Score each dimension 0–2. A passing session requires total ≥ 9/12 and no dimension at 0.

---

## Scoring Scale

| Score | Meaning                                |
| ----- | -------------------------------------- |
| 2     | Fully meets standard verified, no gaps |
| 1     | Partially meets minor gaps, fixable    |
| 0     | Fails blocking issue, do not accept    |

---

## Dimension 1: Correctness (0–2)

Does the code implement exactly what was requested, no more, no less?

**Evidence required**: Run the feature's verification command from `feature_list.json`. Output must match expected.

| Check                                                              | Pass? |
| ------------------------------------------------------------------ | ----- |
| Feature behavior matches the `behavior` field in feature_list.json |       |
| No unasked-for features added                                      |       |
| No hardcoded values that should be in MongoDB config               |       |
| Keno: 20 unique numbers 1–80 if draw-related                       |       |
| Bingo: 90-ball rules preserved if game-related                     |       |
| Money values: integer minor units only, no floats                  |       |

**Score**: \_\_\_ / 2

---

## Dimension 2: Verification (0–2)

Was the work verified by commands, not by agent confidence?

| Check                                                                         | Pass? |
| ----------------------------------------------------------------------------- | ----- |
| `npx tsc --noEmit` exits 0 (backend)                                          |       |
| `cd frontend && npx tsc --noEmit && npm run build` exits 0 (frontend changes) |       |
| `npm run test:unit` passes if game math was touched                           |       |
| Feature's own verification command from feature_list.json was run             |       |
| No "it should work" without running it                                        |       |

**Score**: \_\_\_ / 2

---

## Dimension 3: Scope Discipline (0–2)

Did the agent touch only what was needed? (Surgical changes principle)

| Check                                                                      | Pass? |
| -------------------------------------------------------------------------- | ----- |
| Diff contains only files relevant to the requested task                    |       |
| No adjacent refactors, style fixes, or "improvements" to untouched modules |       |
| No new dependencies added without explicit request                         |       |
| `Math.random()` not introduced anywhere                                    |       |
| `WalletService` used for all wallet mutations (no direct document writes)  |       |

**Score**: \_\_\_ / 2

---

## Dimension 4: Domain Rule Compliance (0–2)

Are the non-negotiable domain rules from `CLAUDE.md` respected?

| Check                                                            | Pass? |
| ---------------------------------------------------------------- | ----- |
| Wallet mutation → ledger entry created in same transaction       |       |
| Idempotency key passed for ticket purchase / settlement          |       |
| RNG calls go through `RngService`, not `Math.random()`           |       |
| New modules: DI wired correctly (JwtModule if JwtAuthGuard used) |       |
| Telegram not imported in game/wallet/ledger/rng modules          |       |
| No payment gateways, KYC, AML added                              |       |

**Score**: \_\_\_ / 2

---

## Dimension 5: State Handoff (0–2)

Is the session state persisted so the next session can resume in < 5 minutes?

| Check                                                          | Pass? |
| -------------------------------------------------------------- | ----- |
| `PROGRESS.md` updated with what changed and what's next        |       |
| `feature_list.json` statuses updated with evidence             |       |
| `DECISIONS.md` updated if a non-obvious design choice was made |       |
| No orphan in_progress features left without notes              |       |
| Clean-state checklist completed                                |       |

**Score**: \_\_\_ / 2

---

## Dimension 6: Maintainability (0–2)

Will a future agent (or developer) understand and safely modify this code?

| Check                                                        | Pass? |
| ------------------------------------------------------------ | ----- |
| No unexplained magic numbers (use named constants or config) |       |
| New DTOs validated with class-validator                      |       |
| New endpoints have @ApiTags / @ApiOkResponse decorators      |       |
| Error messages are specific (not "something went wrong")     |       |
| No console.log left in committed code                        |       |

**Score**: \_\_\_ / 2

---

## Total

| Dimension              | Score       |
| ---------------------- | ----------- |
| Correctness            | \_\_\_      |
| Verification           | \_\_\_      |
| Scope Discipline       | \_\_\_      |
| Domain Rule Compliance | \_\_\_      |
| State Handoff          | \_\_\_      |
| Maintainability        | \_\_\_      |
| **Total**              | \_\_\_ / 12 |

**Pass threshold**: ≥ 9/12, no dimension at 0.

---

## Action on Failure

If any dimension scores 0 → **do not merge / deploy**. Fix that dimension first.  
If total < 9 → fix lowest-scoring dimensions before next feature.
