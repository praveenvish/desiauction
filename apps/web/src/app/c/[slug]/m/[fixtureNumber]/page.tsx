import { env } from "../../../../../env";
import { notFound } from "next/navigation";
import { currentSession } from "../../../../../server/auth/actions";
import { pushPublicKey } from "../../../../../server/messaging/actions";
import { publicPage } from "../../../../../server/scoring/public-page";
import { LiveView } from "./live-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Live match", robots: { index: true, follow: true } };
export default async function LivePage({
  params,
}: {
  params: Promise<{ slug: string; fixtureNumber: string }>;
}) {
  const address = await params;
  let fixtureNumber: string;
  try {
    fixtureNumber = decodeURIComponent(address.fixtureNumber);
  } catch {
    notFound();
  }
  const facts = await publicPage({ slug: address.slug, fixtureNumber });
  if (!facts) notFound();
  const session = await currentSession();
  return (
    <LiveView
      wsPath={env.NEXT_PUBLIC_LIVE_WS_PATH}
      facts={facts}
      signedIn={session !== null}
      pushKey={session ? await pushPublicKey() : null}
      paintedAt={facts.readAt}
    />
  );
}
