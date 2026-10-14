import { env } from "../../../env";
import { notFound } from "next/navigation";
import { currentSession } from "../../../server/auth/actions";
import { pushPublicKey } from "../../../server/messaging/actions";
import { publicPage } from "../../../server/scoring/public-page";
import { LiveView } from "../../c/[slug]/m/[fixtureNumber]/live-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Live match", robots: { index: false, follow: false } };
export default async function ShareLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ shareToken: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { shareToken } = await params;
  const { tab } = await searchParams;
  const facts = await publicPage({ token: shareToken });
  if (!facts) notFound();
  const session = await currentSession();
  return (
    <LiveView
      wsPath={env.NEXT_PUBLIC_LIVE_WS_PATH}
      facts={facts}
      signedIn={session !== null}
      pushKey={session ? await pushPublicKey() : null}
      paintedAt={facts.readAt}
      initialTab={tab === "scorecard" ? "scorecard" : "live"}
    />
  );
}
