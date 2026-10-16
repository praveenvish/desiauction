import { imageResponse } from "../../../../../server/image-text/image-response";
import { publicPage } from "../../../../../server/scoring/public-page";
import { posterFonts } from "../../../../seasons/[slug]/posters/poster-fonts";
import { LIVE_PREVIEW_SIZE, renderLivePreview } from "./live-preview";
export const runtime = "nodejs";
export const revalidate = 15;
export const alt = "Live match score · DesiAuction";
export const size = LIVE_PREVIEW_SIZE;
export const contentType = "image/png";
export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ slug: string; fixtureNumber: string }>;
}) {
  const address = await params;
  let fixtureNumber: string;
  try {
    fixtureNumber = decodeURIComponent(address.fixtureNumber);
  } catch {
    return imageResponse(renderLivePreview(null), { ...size, fonts: await posterFonts() });
  }
  const facts = await publicPage({ slug: address.slug, fixtureNumber });
  return imageResponse(renderLivePreview(facts), { ...size, fonts: await posterFonts() });
}
