// Twitter renders the same card as OpenGraph (one renderer, two meta channels).
// Route-segment config MUST be declared here — Next only statically analyses
// config exports that live in the route file itself; a re-exported
// `runtime`/`revalidate` is silently ignored.
import { SHARE_IMAGE_SIZE } from "../c/[slug]/share-image-card";

export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "DesiAuction pricing — one pass per tournament";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
