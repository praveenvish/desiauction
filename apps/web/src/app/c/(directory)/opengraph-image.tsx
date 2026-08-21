import { ImageResponse } from "next/og";

import { SHARE_IMAGE_SIZE, renderShareFallback } from "../[slug]/share-image-card";

/**
 * The directory's own card.
 *
 * The root `opengraph-image` covers every public route that does not declare
 * one — except this one. `/c` builds its metadata in `generateMetadata` (it has
 * to: the title reflects the active search term and filter), and a segment that
 * returns its own `openGraph` object does not pick up an ANCESTOR's file
 * convention. Verified rather than assumed: after the root card shipped, 29 of
 * 30 public routes emitted an `og:image` and this was the one that did not.
 *
 * A file in this segment is the fix, and it is one line of difference from the
 * root — same card, because the directory is the product's front door for
 * anyone arriving from a forwarded link, and it should look like the product.
 */
export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "Tournaments on DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(renderShareFallback(), { ...size });
}
