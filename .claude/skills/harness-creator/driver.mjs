#!/usr/bin/env node
/**
 * harness-creator driver.mjs
 *
 * Creates all 5 harness subsystems in a target project:
 *   1. Instructions  -> AGENTS.md, CLAUDE.md
 *   2. State         -> feature_list.json, PROGRESS.md
 *   3. Verification  -> evaluator-rubric.md, method-map.md
 *   4. Scope         -> feature_list.json scope primitives
 *   5. Session       -> init.sh, session-handoff.md, clean-state-checklist.md
 *
 * Usage:
 *   node driver.mjs [options]
 *
 * Options:
 *   --target <dir>      Project root to scaffold (default: cwd)
 *   --name   <name>     Project name (default: auto-detected)
 *   --stack  <stack>    Override detected stack
 *                       (nestjs|nextjs|react|express|nodejs|python|go|rust|generic)
 *   --force             Overwrite existing files
 *   --dry-run           Print what would be created; write nothing
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';

// ---- CLI args ----------------------------------------------------------------

const { values } = parseArgs({
    options: {
        target: { type: 'string', default: process.cwd() },
        name: { type: 'string' },
        stack: { type: 'string' },
        force: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
    },
    strict: false,
});

const TARGET = resolve(values.target);
const FORCE = values.force;
const DRY_RUN = values['dry-run'];

// ---- Detection ---------------------------------------------------------------

function detectStack(dir) {
    if (values.stack) return values.stack;
    if (existsSync(join(dir, 'package.json'))) {
        const pkg = safeJson(join(dir, 'package.json'));
        const deps = {
            ...(pkg.dependencies ?? {}),
            ...(pkg.devDependencies ?? {}),
        };
        if (deps['@nestjs/core']) return 'nestjs';
        if (deps['next']) return 'nextjs';
        if (deps['react']) return 'react';
        if (deps['express']) return 'express';
        if (deps['fastify']) return 'fastify';
        return 'nodejs';
    }
    if (
        existsSync(join(dir, 'pyproject.toml')) ||
        existsSync(join(dir, 'setup.py'))
    )
        return 'python';
    if (existsSync(join(dir, 'go.mod'))) return 'go';
    if (existsSync(join(dir, 'Cargo.toml'))) return 'rust';
    return 'generic';
}

function detectName(dir) {
    if (values.name) return values.name;
    if (existsSync(join(dir, 'package.json'))) {
        const pkg = safeJson(join(dir, 'package.json'));
        if (pkg.name) return pkg.name;
    }
    return basename(dir);
}

const STACK_BUILD = {
    nestjs: 'npm run build',
    nextjs: 'npm run build',
    react: 'npm run build',
    express: 'npx tsc --noEmit',
    nodejs: 'npx tsc --noEmit',
    python: 'python -m py_compile src/**/*.py',
    go: 'go build ./...',
    rust: 'cargo build',
    generic: 'echo "no build step defined"',
};

const STACK_TEST = {
    nestjs: 'npm test -- --forceExit',
    nextjs: 'npm test',
    react: 'npm test -- --watchAll=false',
    express: 'npm test',
    nodejs: 'npm test',
    python: 'pytest',
    go: 'go test ./...',
    rust: 'cargo test',
    generic: 'echo "no test command defined"',
};

const STACK_DEV = {
    nestjs: 'npm run start:dev',
    nextjs: 'npm run dev',
    react: 'npm run dev',
    express: 'node src/index.js',
    nodejs: 'node src/index.js',
    python: 'uvicorn main:app --reload',
    go: 'go run ./...',
    rust: 'cargo run',
    generic: 'echo "define your dev command"',
};

const STACK_INSTALL = {
    nestjs: 'npm install',
    nextjs: 'npm install',
    react: 'npm install',
    express: 'npm install',
    nodejs: 'npm install',
    python: 'pip install -r requirements.txt',
    go: 'go mod download',
    rust: 'cargo fetch',
    generic: 'echo "define your install command"',
};

const STACK_LABEL = {
    nestjs: 'NestJS + TypeScript (see AGENTS.md for full stack details)',
    nextjs: 'Next.js + TypeScript full-stack',
    react: 'React + TypeScript frontend',
    express: 'Express + Node.js',
    nodejs: 'Node.js',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    generic: 'See AGENTS.md for stack details',
};

// ---- Helpers -----------------------------------------------------------------

function safeJson(p) {
    try {
        return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
        return {};
    }
}

const written = [];
const skipped = [];

function write(relPath, content) {
    const fullPath = join(TARGET, relPath);
    if (existsSync(fullPath) && !FORCE) {
        skipped.push(relPath);
        return;
    }
    if (DRY_RUN) {
        written.push(relPath + '  (dry-run)');
        return;
    }
    mkdirSync(fullPath.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
    written.push(relPath);
}

// ---- Templates ---------------------------------------------------------------

function tAgentsMd(name, stack, build, test, dev, install) {
    return `# ${name}  Agent Guide

Practical working reference for AI coding agents. Read alongside \`CLAUDE.md\` (domain rules).

---

## Session Start Protocol

Before writing any code:

1. Read \`PROGRESS.md\`  current verified state and next actions
2. Check \`feature_list.json\`  pick the first \`not_started\` or \`in_progress\` feature
3. Work on **one feature at a time** (WIP=1). Only advance after the verification command exits 0.
4. If something fails, check \`.harness/method-map.md\` before modifying code

## Session End Protocol

Before closing:

1. Run the verification command from \`feature_list.json\` for everything you changed
2. Update \`PROGRESS.md\` with what changed and what's next
3. Update \`feature_list.json\` status + evidence fields
4. Complete \`.harness/clean-state-checklist.md\` (build, tests, no stale artifacts)
5. Add any non-obvious design choices to \`DECISIONS.md\`

## Definition of Done

A feature is done when  and only when  its verification command exits 0:

\`\`\`bash
${build}
${test}
\`\`\`

Agent confidence is not a completion signal. The verification command is.

---

## Harness Files

| File | When to read |
| --- | --- |
| \`PROGRESS.md\` | Every session start and end |
| \`feature_list.json\` | Every session start  pick next task |
| \`DECISIONS.md\` | Before making any architectural choice |
| \`.harness/method-map.md\` | When a bug or build failure occurs |
| \`.harness/topics/\` | When working on a specific domain area |
| \`.harness/clean-state-checklist.md\` | Every session end |
| \`.harness/evaluator-rubric.md\` | Before considering a session complete |

---

## Running the Stack

\`\`\`bash
${install}
${dev}
${build}
${test}
\`\`\`

---

## Adding a New Feature  Checklist

1. Write the implementation
2. Write or update tests
3. Run the verification command  both commands above must exit 0
4. Update \`feature_list.json\` status to \`passing\`
5. Update \`PROGRESS.md\`

---

## What NOT to Change Without Being Asked

- Do not refactor code unrelated to the current feature
- Do not change test infrastructure without an explicit task
- Do not add dependencies without approval
- Do not edit existing \`DECISIONS.md\` entries  only append new ones
`;
}

function tClaudeMd(name, stack) {
    return `# ${name}  Domain Rules

> Apply to all agents and contributors. Supplements \`AGENTS.md\`.

## Stack

- ${STACK_LABEL[stack] ?? STACK_LABEL.generic}

## Non-Negotiable Rules

- Keep module boundaries clear; do not cross-import between unrelated modules.
- All inputs must be validated before use.
- Errors must produce structured responses without leaking internals.
- No secrets, credentials, or API keys in source code.

## Testing Expectations

- Unit-test all business logic in isolation.
- Integration-test all external boundaries (database, API, queues).
- Every new feature ships with at least one passing test.

## Implementation Discipline

- Keep changes focused on the requested feature or fix.
- Do not introduce abstractions beyond what the task requires.
- Prefer readable code over compact code.
- When adding background jobs, make them restart-safe and retry-safe.
`;
}

function tFeatureList(name) {
    return (
        JSON.stringify(
            {
                _meta: {
                    schema_version: '1.0',
                    project: name,
                    wip_limit: 1,
                    status_transitions: [
                        'not_started',
                        'in_progress',
                        'blocked',
                        'passing',
                    ],
                },
                features: [
                    {
                        id: 'FEAT-01',
                        title: 'Initial project setup',
                        status: 'not_started',
                        scope: 'Define project structure and initial configuration.',
                        verification:
                            'echo "Replace with your real verification command"',
                        evidence: null,
                        blocked_by: [],
                        notes: '',
                    },
                ],
            },
            null,
            2,
        ) + '\n'
    );
}

function tProgressMd(name, build, test) {
    const today = new Date().toISOString().slice(0, 10);
    return `# PROGRESS  ${name}

> Session state file. Update at the end of every session.
> New sessions start by reading this file.

---

## Current Verified State

- **Build:** \`${build}\`  not yet verified
- **Tests:** \`${test}\`  not yet verified
- **Last verified:** not yet

---

## Active Feature

None  pick the first \`not_started\` entry in \`feature_list.json\`.

---

## Next Actions

1. Define features in \`feature_list.json\`
2. Run build and test commands to establish a baseline
3. Pick the first feature and begin implementation

---

## Session Log

### ${today}

- Harness files created by harness-creator

---

## Known Blockers

None.
`;
}

function tDecisionsMd(name) {
    const today = new Date().toISOString().slice(0, 10);
    return `# DECISIONS  ${name}

> Settled architectural and design choices.
> Read this before making any architectural decision.
> Only append  never edit existing entries.

---

## D-01: Harness engineering adopted (${today})

**Decision:** Use the harness engineering methodology to structure agent-driven development
(walkinglabs.github.io/learn-harness-engineering).

**Rationale:** Provides reproducible session state, scope discipline (WIP=1), and
command-based verification so agent confidence is never the completion signal.

**Consequences:** All agents must follow session start/end protocols in AGENTS.md.

---
`;
}

function tInitSh(name, install) {
    return `#!/usr/bin/env bash
# .harness/init.sh  Bootstrap: run at the start of every session.
set -e
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

echo "=== ${name}: Session Bootstrap ==="
${install}
echo ""
echo "--- Current PROGRESS ---"
cat PROGRESS.md
echo ""
echo "=== Bootstrap complete. Read PROGRESS.md and feature_list.json to begin. ==="
`;
}

function tSessionHandoff() {
    return `# Session Handoff Template

Fill this in at the end of every session before closing.

---

## What was completed this session

- Feature: <!-- id and title from feature_list.json -->
- Verification passed: <!-- paste command and exit code -->

## What is still in progress

- <!-- anything left in_progress or blocked -->

## Next agent should start by

1. Run \`.harness/init.sh\`
2. Read \`PROGRESS.md\`
3. <!-- specific first action -->

## Non-obvious context for the next session

- <!-- anything not in code or DECISIONS.md -->
`;
}

function tCleanStateChecklist() {
    return `# Clean State Checklist

Complete before ending every session. All 5 must be true.

---

- [ ] **Build passes**  build command exits 0
- [ ] **Tests pass**  test command exits 0
- [ ] **PROGRESS.md updated**  reflects what changed and what's next
- [ ] **feature_list.json updated**  status and evidence fields accurate
- [ ] **No stale artifacts**  no temp files, debug logs, or half-written code committed

If any item is false, fix it before closing the session.
`;
}

function tEvaluatorRubric(build, test) {
    return `# Evaluator Rubric

Score the session on each dimension. Total >= 9/12 passes.

---

| Dimension | 0 - Fail | 1 - Partial | 2 - Pass |
| --- | --- | --- | --- |
| **Correctness** | Broke something | Some regressions | All verification commands exit 0 |
| **Verification** | No commands run | Commands run, partial | \`${build}\` AND \`${test}\` both exit 0 |
| **Scope** | Changed unrelated code | Minor scope creep | Only touched what the task required |
| **Domain Rules** | Violated a CLAUDE.md rule | Bent a rule | All CLAUDE.md rules respected |
| **State Handoff** | PROGRESS.md not updated | Partially updated | PROGRESS.md + feature_list.json fully accurate |
| **Maintainability** | Confusing code added | Some unclear choices | Code readable; DECISIONS.md updated if needed |

**Total: __ / 12**  Pass threshold: >= 9 / 12.
`;
}

function tMethodMap() {
    return `# Method Map  Failure Patterns -> Fixes

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
| Test passes locally, fails in CI | Environment variable missing | Add var to CI config |
| Flaky test | Non-deterministic dependency | Mock the dependency |

---

## Scope Creep

| Symptom | Root Cause | Fix |
| --- | --- | --- |
| Session modifies many unrelated files | Agent refactored adjacent code | Revert; only touch what the task requires |
`;
}

function tTopicPlaceholder(topic) {
    return `# Topic: ${topic}

> Agent topic document. Fill with domain-specific patterns and rules as you build.
> Add a row in AGENTS.md harness files table pointing here with a "When to read" trigger.

---

## Patterns

_Add patterns as you discover them during implementation._

## Gotchas

_Add non-obvious traps and their solutions here._
`;
}

// ---- Main --------------------------------------------------------------------

const stack = detectStack(TARGET);
const name = detectName(TARGET);
const build = STACK_BUILD[stack] ?? STACK_BUILD.generic;
const test = STACK_TEST[stack] ?? STACK_TEST.generic;
const dev = STACK_DEV[stack] ?? STACK_DEV.generic;
const install = STACK_INSTALL[stack] ?? STACK_INSTALL.generic;

console.log('\n=== harness-creator ===');
console.log(`Project : ${name}`);
console.log(`Stack   : ${stack}`);
console.log(`Target  : ${TARGET}`);
console.log(`Force   : ${FORCE}`);
console.log(`Dry-run : ${DRY_RUN}`);
console.log('');

// 1. Instructions subsystem
write('AGENTS.md', tAgentsMd(name, stack, build, test, dev, install));
write('CLAUDE.md', tClaudeMd(name, stack));

// 2. State subsystem
write('feature_list.json', tFeatureList(name));
write('PROGRESS.md', tProgressMd(name, build, test));
write('DECISIONS.md', tDecisionsMd(name));

// 3-5. Session lifecycle + verification subsystems
write('.harness/init.sh', tInitSh(name, install));
write('.harness/session-handoff.md', tSessionHandoff());
write('.harness/clean-state-checklist.md', tCleanStateChecklist());
write('.harness/evaluator-rubric.md', tEvaluatorRubric(build, test));
write('.harness/method-map.md', tMethodMap());

// Topic document stubs
write('.harness/topics/core-patterns.md', tTopicPlaceholder('Core Patterns'));

console.log(`Files written (${written.length}):`);
written.forEach((f) => console.log(`  + ${f}`));

if (skipped.length) {
    console.log(
        `\nSkipped  already exist (use --force to overwrite) (${skipped.length}):`,
    );
    skipped.forEach((f) => console.log(`  ~ ${f}`));
}

if (DRY_RUN) console.log('\nDry-run complete. No files written.');

console.log('\nNext steps:');
console.log('  1. Customise AGENTS.md and CLAUDE.md for your domain rules');
console.log('  2. Define real features in feature_list.json');
console.log('  3. Add domain topic docs in .harness/topics/');
console.log('  4. chmod +x .harness/init.sh   (Linux/macOS)');
console.log('');
