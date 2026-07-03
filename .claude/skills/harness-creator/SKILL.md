---
name: harness-creator
description: >
  Set up harness engineering files in any project — AGENTS.md, CLAUDE.md,
  feature_list.json, PROGRESS.md, DECISIONS.md, and .harness/ subsystem docs.
  Use when starting a new project, inheriting a legacy repo, or bootstrapping
  agent-driven development on any codebase. Based on
  walkinglabs.github.io/learn-harness-engineering (12 lectures).
---

# Harness Creator

When this skill is invoked, create all 5 harness engineering subsystems in the
target project. The target is the current working directory unless the user
specifies another path.

---

## Step 1 — Detect the project

Read the manifest files to determine stack and project name:

- `package.json` → check `dependencies` / `devDependencies`:
  - `@nestjs/core` → **nestjs**
  - `next` → **nextjs**
  - `react` → **react**
  - `express` or `fastify` → **express**
  - anything else → **nodejs**
- `pyproject.toml` or `setup.py` → **python**
- `go.mod` → **go**
- `Cargo.toml` → **rust**
- None of the above → **generic**

Project name: `package.json#name`, or directory basename as fallback.

Stack commands:

| Stack | Install | Build / type-check | Test | Dev server |
| --- | --- | --- | --- | --- |
| nestjs | `npm install` | `npm run build` | `npm test -- --forceExit` | `npm run start:dev` |
| nextjs | `npm install` | `npm run build` | `npm test` | `npm run dev` |
| react | `npm install` | `npm run build` | `npm test -- --watchAll=false` | `npm run dev` |
| express / nodejs | `npm install` | `npx tsc --noEmit` | `npm test` | `node src/index.js` |
| python | `pip install -r requirements.txt` | `python -m py_compile src/**/*.py` | `pytest` | `uvicorn main:app --reload` |
| go | `go mod download` | `go build ./...` | `go test ./...` | `go run ./...` |
| rust | `cargo fetch` | `cargo build` | `cargo test` | `cargo run` |
| generic | *(ask user)* | *(ask user)* | *(ask user)* | *(ask user)* |

---

## Step 2 — Create the 5 subsystems

Do not overwrite files that already exist unless the user explicitly asks.
Create directories as needed (`.harness/`, `.harness/topics/`).

### Subsystem 1: Instructions

**`AGENTS.md`** — agent working guide (Lecture 4 split-instructions pattern):

```
# <name> — Agent Guide

Practical working reference for AI coding agents. Read alongside `CLAUDE.md`.

---

## Session Start Protocol

1. Read `PROGRESS.md` — current verified state and next actions
2. Check `feature_list.json` — pick the first `not_started` or `in_progress` feature
3. Work on **one feature at a time** (WIP=1). Only advance after the verification command exits 0.
4. If something fails, check `.harness/method-map.md` before modifying code

## Session End Protocol

1. Run the verification command for everything you changed
2. Update `PROGRESS.md` with what changed and what's next
3. Update `feature_list.json` status + evidence fields
4. Complete `.harness/clean-state-checklist.md`
5. Add non-obvious design choices to `DECISIONS.md`

## Definition of Done

A feature is done when — and only when — its verification command exits 0:

\`\`\`bash
<build-cmd>
<test-cmd>
\`\`\`

Agent confidence is not a completion signal. The verification command is.

---

## Harness Files

| File | When to read |
| --- | --- |
| `PROGRESS.md` | Every session start and end |
| `feature_list.json` | Every session start — pick next task |
| `DECISIONS.md` | Before making any architectural choice |
| `.harness/method-map.md` | When a bug or build failure occurs |
| `.harness/topics/` | When working on a specific domain area |
| `.harness/clean-state-checklist.md` | Every session end |
| `.harness/evaluator-rubric.md` | Before considering a session complete |

---

## Running the Stack

\`\`\`bash
<install-cmd>
<dev-cmd>
<build-cmd>
<test-cmd>
\`\`\`

---

## Adding a New Feature — Checklist

1. Write the implementation
2. Write or update tests
3. Run build and test commands — both must exit 0
4. Update `feature_list.json` status to `passing`
5. Update `PROGRESS.md`

---

## What NOT to Change Without Being Asked

- Do not refactor code unrelated to the current feature
- Do not add dependencies without approval
- Do not edit existing `DECISIONS.md` entries — only append new ones
```

**`CLAUDE.md`** — non-negotiable domain rules (Lecture 2):

```
# <name> — Domain Rules

> Apply to all agents and contributors. Supplements `AGENTS.md`.

## Stack

- <stack description>

## Non-Negotiable Rules

- Keep module boundaries clear; do not cross-import between unrelated modules.
- All inputs must be validated before use.
- No secrets or credentials in source code.

## Testing Expectations

- Unit-test all business logic in isolation.
- Integration-test all external boundaries (database, API, queues).
- Every new feature ships with at least one passing test.

## Implementation Discipline

- Keep changes focused on the requested feature or fix.
- Do not introduce abstractions beyond what the task requires.
- Prefer readable code over compact code.
```

If `CLAUDE.md` already exists, do not overwrite it — instead check whether it needs the stack section corrected (e.g. wrong database name) and apply a targeted edit only.

---

### Subsystem 2: State

**`feature_list.json`** (Lecture 8 — feature lists as harness primitives):

```json
{
  "_meta": {
    "schema_version": "1.0",
    "project": "<name>",
    "wip_limit": 1,
    "status_transitions": ["not_started", "in_progress", "blocked", "passing"]
  },
  "features": [
    {
      "id": "FEAT-01",
      "title": "Initial project setup",
      "status": "not_started",
      "scope": "Define project structure and initial configuration.",
      "verification": "<build-cmd> && <test-cmd>",
      "evidence": null,
      "blocked_by": [],
      "notes": ""
    }
  ]
}
```

**`PROGRESS.md`** (Lecture 5 — session continuity):

```
# PROGRESS — <name>

> Session state file. Update at the end of every session.

---

## Current Verified State

- **Build:** `<build-cmd>` — not yet verified
- **Tests:** `<test-cmd>` — not yet verified
- **Last verified:** not yet

---

## Active Feature

None — pick the first `not_started` entry in `feature_list.json`.

---

## Next Actions

1. Define features in `feature_list.json`
2. Run build and test commands to establish a baseline
3. Pick the first feature and begin implementation

---

## Session Log

### <today's date>

- Harness files created by /harness-creator

---

## Known Blockers

None.
```

**`DECISIONS.md`** (Lecture 3 — repo as system of record):

```
# DECISIONS — <name>

> Settled architectural and design choices.
> Read before making any architectural decision.
> Only append — never edit existing entries.

---

## D-01: Harness engineering adopted (<today's date>)

**Decision:** Use the harness engineering methodology (walkinglabs.github.io/learn-harness-engineering).

**Rationale:** Provides reproducible session state, WIP=1 scope discipline, and
command-based verification so agent confidence is never the completion signal.

**Consequences:** All agents must follow session start/end protocols in AGENTS.md.

---
```

---

### Subsystem 3–5: Session lifecycle, verification, scope

**`.harness/init.sh`** (Lecture 6 — dedicated init phase):

```bash
#!/usr/bin/env bash
# Run at the start of every session.
set -e
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
echo "=== <name>: Session Bootstrap ==="
<install-cmd>
echo ""
echo "--- Current PROGRESS ---"
cat PROGRESS.md
echo ""
echo "=== Bootstrap complete. Read PROGRESS.md and feature_list.json to begin. ==="
```

**`.harness/session-handoff.md`** (Lecture 12 — clean state at session end):

```
# Session Handoff Template

Fill this in at the end of every session before closing.

---

## What was completed this session

- Feature: <!-- id and title from feature_list.json -->
- Verification passed: <!-- paste command and exit code -->

## What is still in progress

- <!-- anything left in_progress or blocked -->

## Next agent should start by

1. Run `.harness/init.sh`
2. Read `PROGRESS.md`
3. <!-- specific first action -->

## Non-obvious context for the next session

- <!-- anything not captured in code or DECISIONS.md -->
```

**`.harness/clean-state-checklist.md`** (Lecture 12):

```
# Clean State Checklist

Complete before ending every session. All 5 must be true.

- [ ] **Build passes** — build command exits 0
- [ ] **Tests pass** — test command exits 0
- [ ] **PROGRESS.md updated** — reflects what changed and what's next
- [ ] **feature_list.json updated** — status and evidence fields accurate
- [ ] **No stale artifacts** — no temp files, debug logs, or half-written code committed
```

**`.harness/evaluator-rubric.md`** (Lecture 9 — externalize termination judgment):

```
# Evaluator Rubric

Score the session on each dimension. Total >= 9/12 passes.

| Dimension | 0 - Fail | 1 - Partial | 2 - Pass |
| --- | --- | --- | --- |
| **Correctness** | Broke something | Some regressions | All verification commands exit 0 |
| **Verification** | No commands run | Commands run, partial | `<build-cmd>` AND `<test-cmd>` both exit 0 |
| **Scope** | Changed unrelated code | Minor scope creep | Only touched what the task required |
| **Domain Rules** | Violated a CLAUDE.md rule | Bent a rule | All CLAUDE.md rules respected |
| **State Handoff** | PROGRESS.md not updated | Partially updated | PROGRESS.md + feature_list.json fully accurate |
| **Maintainability** | Confusing code added | Some unclear choices | Code readable; DECISIONS.md updated if needed |

**Total: __ / 12** — Pass threshold: >= 9 / 12.
```

**`.harness/method-map.md`** (Lecture 3 — reference material):

```
# Method Map — Failure Patterns -> Fixes

> When a session fails, find the pattern here before touching code.
> Add new rows as you discover failure modes in this project.

---

## Session Continuity Failures

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| New session re-explores project for 15+ min | PROGRESS.md not updated at session end | Update PROGRESS.md every session end |
| Agent makes contradictory design choice | DECISIONS.md not checked | Read DECISIONS.md before writing code |
| Feature declared done without verification | Agent confidence != correctness | Run the verification command first |

---

## Build Failures

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| Type errors after merge | Imported type removed/renamed | Check the import; update to new name |
| Dependency not found | Package not installed | Run install command |

---

## Test Failures

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| Flaky test | Non-deterministic dependency | Mock the dependency |

---

## Scope Creep

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| Session modifies many unrelated files | Agent refactored adjacent code | Revert; only touch what the task requires |
```

**`.harness/topics/core-patterns.md`** — stub topic document (Lecture 4):

```
# Topic: Core Patterns

> Add domain-specific patterns here as you build.
> Reference this file from AGENTS.md harness files table with a "When to read" entry.

## Patterns

_Add patterns as you discover them._

## Gotchas

_Add non-obvious traps and fixes here._
```

---

## Step 3 — Report

After creating all files, print a summary:

- List every file created
- List any files skipped (already existed)
- Remind the user of the 4 post-creation steps:
  1. Customise `AGENTS.md` with real domain-specific rules
  2. Customise `CLAUDE.md` with your project's non-negotiable rules
  3. Replace the placeholder in `feature_list.json` with your real backlog
  4. Add topic docs to `.harness/topics/` as the project grows (`chmod +x .harness/init.sh` on Linux/macOS)

---

## Notes

- The `driver.mjs` file in this skill directory is an **optional** standalone Node.js script
  that does the same thing without Claude — useful for CI bootstrapping or projects where
  Claude Code is not available. It is not part of the skill invocation path.
- The iGames project (`d:/Personal/iGames/`) has a fully elaborated harness you can reference
  as a real-world example of all these files filled in for a NestJS + MySQL project.
