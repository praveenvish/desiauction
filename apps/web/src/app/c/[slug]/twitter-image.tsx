// Twitter renders the same card as OpenGraph (one renderer, two meta channels).
// The default (image generator) is re-exported, but the route-segment config MUST
// be declared here — Next only statically analyses config exports that live in the
// route file itself; re-exported `runtime`/`revalidate` are silently ignored.
import { SHARE_IMAGE_SIZE } from "./share-image-card";

export { default } from "./opengraph-image";

export const runtime = "nodejs";
// A withdrawn player 404s on their page immediately, and a season pulled
// from publication vanishes with it — but this card kept previewing the person
// for up to an hour afterwards. An hour is a reasonable number for a stats
// cache and the wrong number for a takedown, which is what this cache is on the
// far side of.
export const revalidate = 60;
export const alt = "Live player-auction on DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
