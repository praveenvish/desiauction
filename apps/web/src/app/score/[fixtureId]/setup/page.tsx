import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "../../../../server/auth/actions";
import { scoringAcceptedSetupForPerson } from "../../../../server/scoring/home";
import { InAppGate } from "../../in-app-gate";
import { SetupFlow } from "./setup-flow";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Match setup", robots: { index: false, follow: false } };
export default async function SetupPage({ params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/score/${fixtureId}/setup`)}`);
  const loaded = await scoringAcceptedSetupForPerson(fixtureId, session.personId);
  if (!loaded) notFound();
  const { setup, accepted } = loaded;
  if (setup.phase && setup.phase !== "not_started") redirect(`/score/${fixtureId}`);
  return (
    <InAppGate>
      <SetupFlow setup={setup} actorId={session.personId} accepted={accepted} />
    </InAppGate>
  );
}
