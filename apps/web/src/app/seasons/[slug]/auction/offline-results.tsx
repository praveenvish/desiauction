"use client";

import dynamic from "next/dynamic";

/*
 * The Auction tab of a season run offline types its results in here, but
 * every OTHER season's Auction tab — a live room's front door — must not ship
 * the results list and the publish dialog in its first load (they cost
 * ~17 kB and broke the route's bundle budget). Split out, loaded only when an
 * offline season actually draws them.
 */
export const OfflineResultsSheet = dynamic(
  () => import("../teams/results-sheet").then((module) => module.ResultsSheet),
  { loading: () => <p className="pd-quiet">Loading players…</p> },
);

export const OfflinePublish = dynamic(() =>
  import("../teams/hand-entry").then((module) => module.PublishByHand),
);
