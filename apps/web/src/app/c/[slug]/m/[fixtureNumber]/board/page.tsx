import { notFound } from "next/navigation";
import { overlayPageFacts } from "../../../../../../server/scoring/overlay-page";
import { publicLiveOverlay } from "../../../../../../server/scoring/public";
import { OverlayView } from "../overlay/overlay-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Match board", robots: { index: false, follow: false } };
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; fixtureNumber: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const facts = await overlayPageFacts(await params, (await searchParams).t);
  if (!facts) notFound();
  return (
    <OverlayView
      facts={facts}
      initial={await publicLiveOverlay(facts.fixtureId, facts.proof)}
      board
    />
  );
}
