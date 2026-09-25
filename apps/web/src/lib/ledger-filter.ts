/**
 * THE LEDGER'S THREE READINGS: everything, the bidding, or the results.
 *
 * A finished auction's ledger opened on a page of "Lot prepared", "Owner
 * invited" and "Lot queued" — the setup of the night — and the first sale was
 * on page 2 of 8. The record stays whole (the ledger's guarantee is that it
 * regenerates from the event log); this only chooses which rows a page shows.
 *
 * Classified by the row's `result` words because that is what core's certified
 * fold (`buildAuctionLedger`) emits, and it is kept free of any other kind tag.
 * Pure, so the vocabulary it relies on is pinned by a test next door.
 */
export const LEDGER_FILTERS = ["all", "bids", "results"] as const;
export type LedgerFilter = (typeof LEDGER_FILTERS)[number];

export function parseLedgerFilter(raw: string | undefined): LedgerFilter | null {
  return LEDGER_FILTERS.find((filter) => filter === raw) ?? null;
}

/** A bid placed, refused or voided. */
function isBid(result: string): boolean {
  return result.startsWith("Bid ");
}

/** What happened to a player: sold, unsold, withdrawn, or a sale undone. */
function isResult(result: string): boolean {
  return (
    result === "SOLD" ||
    result === "UNSOLD" ||
    result === "Lot withdrawn" ||
    result.startsWith("UNDO")
  );
}

export function ledgerRowMatches(filter: LedgerFilter, result: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "bids":
      return isBid(result);
    case "results":
      return isResult(result);
  }
}
