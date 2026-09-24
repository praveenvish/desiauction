// Twitter renders the same squad card as OpenGraph (one renderer, two channels).
// Route-segment config MUST be declared here — Next ignores re-exported
// `runtime`/`revalidate` (it only statically analyses config in the route file).
import { LINK_CARD_SIZE } from "../../../../seasons/[slug]/posters/poster-link";

export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const revalidate = 60;
export const alt = "Team squad · DesiAuction";
export const size = LINK_CARD_SIZE;
export const contentType = "image/png";
