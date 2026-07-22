// Twitter renders the same player card as OpenGraph (one renderer, two channels).
// Route-segment config MUST be declared here — Next ignores re-exported
// `runtime`/`revalidate` (it only statically analyses config in the route file).
import { SHARE_IMAGE_SIZE } from "../../share-image-card";

export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "Player card · DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
