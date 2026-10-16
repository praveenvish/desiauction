import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "../../../../server/auth/actions";
import { InAppGate } from "../../in-app-gate";
import { HandoverAccept } from "./handover-accept";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Take over scoring",
  robots: { index: false, follow: false },
};
export default async function HandoverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await currentSession()))
    redirect(`/login?next=${encodeURIComponent(`/score/handover/${token}`)}`);
  return (
    <InAppGate>
      <HandoverAccept token={token} />
    </InAppGate>
  );
}
