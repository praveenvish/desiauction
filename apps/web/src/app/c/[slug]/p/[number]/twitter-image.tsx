// Twitter renders the same player card as OpenGraph (one renderer, two channels).
// Route-segment config MUST be declared here — Next ignores re-exported
// `runtime`/`revalidate` (it only statically analyses config in the route file).
import { SHARE_IMAGE_SIZE } from "../../share-image-card";

export { default } from "./opengraph-image";

export const runtime = "nodejs";
// A withdrawn player 404s on their page immediately, and a season pulled
// from publication vanishes with it — but this card kept previewing the person
// for up to an hour afterwards. An hour is a reasonable number for a stats
// cache and the wrong number for a takedown, which is what this cache is on the
// far side of.
export const revalidate = 60;
export const alt = "Player card · DesiAuction";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
