import { ImageResponse } from "next/og";

import { SHARE_IMAGE_SIZE, renderShareFallback } from "./c/[slug]/share-image-card";

/**
 * THE DEFAULT SHARE CARD.
 *
 * The share-card platform was already built and already good — real cards for
 * `/pricing`, a competition, a player and the spectate page. What was missing
 * was a FLOOR: `opengraph-image` is inherited down the route tree, and with
 * none at the root, 24 of the 27 public routes emitted no `og:image` at all.
 * That included the landing page, which is the most-forwarded link the product
 * has, and every help and legal page an organizer sends to a nervous owner.
 *
 * In this market the link is pasted into WhatsApp, where a preview without an
 * image is a grey line of text next to everything else in the thread.
 *
 * `renderShareFallback` already existed for exactly this look and was reachable
 * only as an error path; it is the right card, so it is reused rather than
 * copied. Routes that render something better keep doing so — a file lower in
 * the tree wins.
 *
 * Static, so no database read and no per-request work.
 */
export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "DesiAuction — run your player auction live";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(renderShareFallback(), { ...size });
}
