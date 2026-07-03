# Topic: Frontend Patterns

> Agent topic document (Lecture 4). Loaded when working on anything in `frontend/src/`.

---

## Stack

- React 19 + Vite + TypeScript
- Zustand for global state (`useStore.ts`)
- Axios via `lib/api.ts` (grouped by domain)
- Socket.IO for real-time events (`hooks/useSocketConnection.ts`)
- lucide-react for icons

---

## Adding an API Call

1. Add the TypeScript type to `frontend/src/lib/models.ts`
2. Add the API function to the relevant group in `frontend/src/lib/api.ts`

```typescript
// lib/api.ts — example
export const kenoApi = {
  // existing calls ...
  updateTicketNumbers: (ticketId: string, selectedNumbers: number[]) =>
    api.patch<KenoTicket>(`/keno/tickets/${ticketId}/numbers`, { selectedNumbers }),
};
```

3. Use the function directly in the component — no wrapper layer needed

---

## Money Display

**Never do math on credits in the frontend.** Use the utility functions:

```typescript
import { formatCredits, formatCreditsFull } from '../lib/utils';

formatCredits(50_000)     // → "500.00 ETB"   (compact)
formatCreditsFull(50_000) // → "50,000 credits"
```

All API amounts are in **integer minor units**. 100 minor = 1 ETB (configurable).

---

## Global State (Zustand)

```typescript
const { user, wallet, authStatus, addToast } = useStore();
```

Available actions: `setUser`, `setWallet`, `setAuthStatus`, `addToast`, `clearToasts`.

Do not store game-specific state in Zustand — keep it local to the page component.

---

## Tab Routing

```typescript
// App.tsx controls navigation
type AppTab = 'home' | 'games' | 'keno' | 'bingo' | 'wallet' | 'admin' | 'agent' | 'profile';

// Navigate from a page:
<SomePage onNavigate={(tab: AppTab) => setActiveTab(tab)} />
```

Pages receive `onNavigate` as a prop. Do not import `setActiveTab` from App directly.

---

## Socket.IO Events

```typescript
// hooks/useSocketConnection.ts handles the connection
// Events the frontend listens to:
'keno.draw.started'    // lock countdown
'keno.draw.completed'  // reveal + reload
'bingo.number.drawn'   // optimistic ball reveal
'withdrawal.pending'   // agent panel refresh
'live.counts'          // { playingUsers, waitingUsers, onlineUsers }

// On connect: emit 'request.counts' for immediate count pull
socket.emit('request.counts');
```

---

## Admin Panel Styles

All admin UI uses shared `adm-*` CSS classes from `App.css`. Do not add component-level styles or inline styles to admin tabs.

| Class | Purpose |
| --- | --- |
| `adm-panel` | White card container |
| `adm-panel-head` | Panel title row (left accent bar via `::before`) |
| `adm-kpi` | Metric card with value + label + optional icon |
| `adm-tab-bar` | Nav (horizontal scroll mobile, sticky sidebar ≥900px) |
| `adm-tab.active` | Filled gradient pill for active nav item |
| `adm-dash-grid` | Auto-fit grid for overview dashboard layout |

---

## TypeScript Checks

Before marking any frontend task complete:

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Both must exit 0. The build catches tree-shaking issues and missing exports that `tsc` alone misses.

---

## Error Handling

Use `getErrorMessage(error)` from `lib/utils.ts` to extract the backend's structured error message. Do not access `error.response.data.message` directly — the shape varies.

```typescript
import { getErrorMessage } from '../lib/utils';

try {
  await kenoApi.buyTicket(...)
} catch (err) {
  addToast({ type: 'error', message: getErrorMessage(err) });
}
```
