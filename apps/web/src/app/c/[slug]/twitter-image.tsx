// Twitter renders the same card as OpenGraph (one renderer, two meta channels).
// The default (image generator) is re-exported, but the route-segment config MUST
// be declared here — Next only statically analyses config exports that live in the
// route file itself; re-exported `runtime`/`revalidate` are silently ignored.
import { SHARE_IMAGE_SIZE } from "./share-image-card";

export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "Live player-auction on DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
