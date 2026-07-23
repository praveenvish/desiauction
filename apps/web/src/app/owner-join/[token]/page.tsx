import { Badge, Button, Card } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession } from "../../../server/auth/actions";
import { acceptOwnerJoin, ownerJoinPreview } from "../../../server/auction/owner-actions";
import "../../orgs/orgs.css";

export const metadata = { title: "Team owner invitation · DesiAuction" };

// The owner invitation landing (M-IP4-3): preview without consuming, accept
// once. Acceptance = org membership (identity side) + the AcceptOwnerInvite
// COMMAND (auction side) — then straight to the live room.

export default async function OwnerJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=/owner-join/${token}`);
  }
  const preview = await ownerJoinPreview(token);
  return (
    <main className="join">
      <div className="join-panel">
        <h1>Team owner invitation</h1>
        {preview === null ? (
          <Card>
            <p role="alert">
              This invitation is no longer valid. It may have been used, expired, or withdrawn — ask
              the organizer for a fresh one.
            </p>
          </Card>
        ) : (
          <Card data-testid="owner-join-card">
            <p>
              You&apos;ve been invited to own <Badge tone="info">{preview.teamName}</Badge> in{" "}
              <strong>{preview.auctionName}</strong> ({preview.competitionName}).
            </p>
            <p>
              Accepting makes you this team&apos;s owner. The organizer then grants your paddle, and
              you claim it in the live room.
            </p>
            <form
              action={async () => {
                "use server";
                const result = await acceptOwnerJoin(token);
                if (result.ok) {
                  redirect(`/seasons/${result.competitionSlug}/auction/live`);
                }
              }}
            >
              <Button type="submit" data-testid="accept-owner-invite">
                Accept — own {preview.teamName}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}
