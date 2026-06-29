# Session Handoff

> Fill this out at the end of every work session. The next session reads it first before touching any code.

---

## Date / Branch
- Date: ___________
- Branch: ___________
- Duration: ___________

---

## Currently Verified State

```bash
# Commands that PASS right now:
npx tsc --noEmit           # backend
cd frontend && npx tsc --noEmit && npm run build   # frontend
```

Passing: [ ] Backend tsc  [ ] Frontend tsc  [ ] Frontend build  [ ] Unit tests

---

## What Changed This Session

- [ ] ___________
- [ ] ___________
- [ ] ___________

Commits made:
```
git log --oneline -5
```

---

## Still Broken / Incomplete

| Item | Why not finished | Next action |
|---|---|---|
| | | |

---

## Feature List Updates

Features moved to `passing` this session:
- (id): ___________

Features started (moved to `in_progress`):
- (id): ___________

---

## Next Best Action

> One sentence. What should the very next session do first?

___________

---

## Commands Needed Next Session

```bash
# Example:
# Run MySQL migration:
# ALTER TABLE crash_round ROW_FORMAT=DYNAMIC;

# Deploy:
# git pull && npm run build && pm2 restart igames-backend
```

---

## Context the Next Session Must Know

> Anything that isn't obvious from reading the code or PROGRESS.md. Omit if nothing surprising.

___________
