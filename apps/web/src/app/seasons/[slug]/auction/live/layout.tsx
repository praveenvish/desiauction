import type { ReactNode } from "react";

import { requireOnboarded } from "../../../../../server/auth/onboarding-gate";

/**
 * THE NAME GATE, on the one console surface that never had it.
 *
 * `/seasons/[slug]/auction/live` is the room where money is spent, and it was
 * the only signed-in surface in this tree with no `onboarded-layout` above it —
 * while `acceptOwnerJoin` redirects STRAIGHT here. Both accepted owners on the
 * demo auction have `people.name = NULL` as a result. The gate's own note says
 * exactly what that costs: those accounts appear as a raw phone number on team
 * sheets, receipts and settlement records, permanently, with no prompt ever
 * shown — and a squad sheet reading "+919330100281 bought Rahul Menon for ₹40
 * lakh" is the record of the night.
 *
 * The gate is not mounted on the sibling live segments on purpose: /spectate is
 * public, and /overlay and /board are chrome-free projector surfaces that
 * nobody signs into. It IS written as its own file rather than the shared
 * one-line re-export because it passes its own address, so the interruption
 * returns the owner to the room instead of dropping them on /home mid-auction.
 *
 * Not a `loading.tsx`: a Suspense boundary above a gated page commits a 200
 * before the gate runs, and the redirect never reaches the browser.
 */
export default async function LiveAuctionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireOnboarded(`/seasons/${slug}/auction/live`);
  return <>{children}</>;
}
