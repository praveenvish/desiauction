/**
 * The delivery workspace's presentation contract (PX-8 §2).
 *
 * Pure, and in a PLAIN module so the regression suite can attack it without a
 * browser and a server component can validate `?lane=` against it (the PX-7
 * client-reference-proxy finding).
 *
 * PX-11 architecture fix: this module no longer imports the `DeliveryView` type
 * from `views` — `filterDeliveries` is generic over the only field it reads
 * (`status`). That removed a type-level import cycle (`deliveries ↔ views`)
 * flagged by the new `no-circular` dependency-cruiser gate; the dependency now
 * flows one way (`views` → `deliveries`), which is exactly what the note below
 * always intended.
 */

/**
 * The platform's four dispatch statuses, in lifecycle order.
 *
 * They live HERE, in the pure module, and `views` imports them upward — never
 * the reverse. A CLIENT panel imports this file, so a value import from `views`
 * would drag `@desiauction/financial-operations/server` (and `node:fs`) into
 * the browser bundle. Typecheck cannot see that; the production build can.
 */
export const DELIVERY_LANES = ["requested", "sent", "confirmed", "failed"] as const;

/**
 * "Succeeded" was a promise the platform cannot keep.
 *
 * The `in-app` adapter returns `ok`/`confirmed` unconditionally, on the
 * reasoning that "delivery IS visibility — the dispatch register is the tray a
 * signed-in officer reads". But that register is org-scoped and finance-gated,
 * so the actual recipient — the team owner who paid — sees nothing: `/inbox`
 * carries security events only. And `email` writes a `.txt` file into a local
 * directory; there is no SMTP. So a receipt the customer never got was reported
 * to the operator as "Succeeded".
 *
 * These labels now describe what the platform actually observed. Fixing the
 * adapters means thawing IP-6; telling the truth about them does not.
 */
export const DELIVERY_LANE_LABEL: Record<string, string> = {
  requested: "Queued",
  sent: "Processing",
  confirmed: "Recorded as sent",
  failed: "Failed",
};

export function isDeliveryLane(value: string): boolean {
  return (DELIVERY_LANES as readonly string[]).includes(value);
}

/**
 * Upholds: an unknown or absent lane shows EVERY delivery. A filter must never
 * hide a failed delivery behind a typo.
 */
export function filterDeliveries<T extends { readonly status: string }>(
  rows: readonly T[],
  lane: string,
): readonly T[] {
  return isDeliveryLane(lane) ? rows.filter((row) => row.status === lane) : rows;
}
