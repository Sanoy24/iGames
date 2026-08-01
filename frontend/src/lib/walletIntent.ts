// A one-shot cross-page signal: Home's "Deposit" quick-action sets this right
// before navigating to the Wallet tab, so Wallet can open its deposit panel
// immediately on arrival instead of requiring a second "Top Up" click. Module
// state (not a query param) because navigation here is just an in-memory tab
// switch (see App.tsx activeTab), not a route change.
let openDepositRequested = false;

export function requestOpenDeposit(): void {
  openDepositRequested = true;
}

/** Reads and clears the pending request in one step, so it only fires once. */
export function consumeOpenDepositRequest(): boolean {
  const requested = openDepositRequested;
  openDepositRequested = false;
  return requested;
}
