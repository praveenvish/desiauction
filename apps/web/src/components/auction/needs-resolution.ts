/**
 * THE COCKPIT'S "NEEDS RESOLUTION" LIST, RECONCILED WITH THE LIVE ROOM.
 *
 * The lot queue right above it reads the socket snapshot; this list read the
 * server-rendered `view.view.lots`, which only moves when the page refreshes.
 * So the moment a frozen lot was requeued the cockpit showed it TWICE — back in
 * the queue with an Open button, and still under "Needs resolution" with a live
 * Requeue button — until `router.refresh()` came back. On a second cockpit
 * window, which never refreshes itself, it stayed that way.
 *
 * Two things followed. A conductor could requeue the same lot again and be told
 * the engine refused it, over a lot that was plainly fine. And the section then
 * vanished a beat later, shifting the queue under the pointer: the cross-browser
 * e2e caught a click on "Open" landing on empty space as the list jumped, and
 * the lot never opened.
 *
 * The snapshot has no frozen/unsold list of its own, but it knows exactly which
 * lots are NOT in need of resolution any more: anything back in the queue or on
 * the block. Those are dropped here, so both sections move on the same frame.
 * A lot newly frozen elsewhere still arrives with the next refresh, as before.
 */
export interface ResolvableLot {
  readonly id: string;
  readonly status: string;
}

export function lotsNeedingResolution<T extends ResolvableLot>(
  lots: readonly T[],
  /** The live snapshot, or the parts of it this reads (null before the first frame). */
  snapshot: {
    readonly queue: readonly { readonly lotId: string }[];
    readonly currentLot: { readonly lotId: string } | null;
  } | null,
): T[] {
  const moved = new Set<string>();
  for (const entry of snapshot?.queue ?? []) {
    moved.add(entry.lotId);
  }
  if (snapshot?.currentLot) {
    moved.add(snapshot.currentLot.lotId);
  }
  return lots.filter(
    (entry) => (entry.status === "frozen" || entry.status === "unsold") && !moved.has(entry.id),
  );
}

/**
 * THE LOTS "REQUEUE ALL UNSOLD" SENDS BACK, and only those.
 *
 * Between rounds the unsold come back as a batch, and a conductor clicking
 * Requeue eight times in a row on auction night is eight chances to hit the
 * wrong row. Frozen lots are deliberately left out: one can carry a standing
 * bid the conductor froze on purpose, and each needs its own decision —
 * requeue or withdraw — not a sweep.
 */
export function unsoldToRequeue<T extends ResolvableLot>(needsResolution: readonly T[]): T[] {
  return needsResolution.filter((entry) => entry.status === "unsold");
}
