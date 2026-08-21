// Twitter renders the same default card as OpenGraph (one renderer, two meta
// channels). The route-segment config MUST be declared here rather than
// re-exported — Next only statically analyses config exports that live in the
// route file itself, and a re-exported `runtime`/`revalidate` is silently
// ignored.
import { SHARE_IMAGE_SIZE } from "./c/[slug]/share-image-card";

export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "DesiAuction — run your player auction live";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
