# Clean State Checklist

> Run before ending every session. All 5 conditions must pass. A session is not complete until this checklist is green.

---

## The 5 Non-Negotiable Conditions

### 1. Build Passes

```bash
npx tsc --noEmit
```
[ ] Backend TypeScript: no errors

```bash
cd frontend && npx tsc --noEmit && npm run build
```
[ ] Frontend TypeScript: no errors  
[ ] Frontend build: ✓ (vite build succeeds)

---

### 2. Tests Pass

```bash
npm run test:unit
```
[ ] Unit tests: all passing (game math, keno spot validation, bingo grid logic)

If integration tests exist:
```bash
npm test
```
[ ] All tests: passing

---

### 3. Progress Recorded

[ ] `PROGRESS.md` updated with:
  - Today's date
  - What was completed this session
  - What is still broken / pending
  - Next best action

[ ] `feature_list.json` updated:
  - All `in_progress` features have accurate status
  - Completed features moved to `passing` with evidence field filled
  - New work reflected

---

### 4. No Stale Artifacts

[ ] No `console.log()` debug statements left in committed code  
[ ] No commented-out code blocks added this session  
[ ] No `TODO` comments left without a matching feature_list entry  
[ ] No temp/debug files (`.tmp`, `debug-*.json`, `test-output.*`) in repo root  
[ ] No uncommitted secrets or `.env` changes staged

---

### 5. Startup Path Available

[ ] `AGENTS.md` still accurate (no new modules/routes added without doc update)  
[ ] New environment variables (if any) documented in `AGENTS.md` env table  
[ ] Next session can run `.harness/init.sh` and be ready within 5 minutes  
[ ] `DECISIONS.md` updated with any non-obvious design choice made this session

---

## Git Checkpoint

```bash
git status
git diff --stat
git add <specific files>
git commit -m "feat(area): what was done"
```

[ ] Working tree clean (or intentionally unstaged changes documented above)

---

## Quick Self-Check Questions

1. If a fresh session started right now with only repo access, could it answer:
   - What is this system? ✓ (CLAUDE.md + AGENTS.md)
   - How do I run it? ✓ (AGENTS.md → Running the Stack)
   - How do I verify it? ✓ (AGENTS.md → Adding a New Feature Checklist)
   - What's the current progress? ✓ (PROGRESS.md)
   - What's next? ✓ (PROGRESS.md → Next best actions)

2. Is WIP=1 maintained? (No `in_progress` feature left partially done without a note)

3. Would the next session waste time re-discovering something I already know?
   → If yes: add it to PROGRESS.md or DECISIONS.md now.
