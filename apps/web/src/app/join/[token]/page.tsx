import { Badge, Button, Card } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession } from "../../../server/auth/actions";
import { acceptInviteAction, invitePreview } from "../../../server/orgs/actions";
import "../../orgs/orgs.css";

export const metadata = { title: "Join · DesiAuction" };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=/join/${token}`);
  }
  const preview = await invitePreview(token);
  return (
    <main className="join">
      <div className="join-panel">
        <h1>Join an organization</h1>
        {preview === null ? (
          <Card>
            <p role="alert">
              This invite link is no longer valid. It may have been used, expired, or withdrawn —
              ask the organizer for a fresh one.
            </p>
          </Card>
        ) : (
          <Card data-testid="join-card">
            <p>
              You&apos;ve been invited to <strong>{preview.orgName}</strong> as{" "}
              <Badge tone="info">{preview.capabilitySet}</Badge>
            </p>
            <form
              action={async () => {
                "use server";
                await acceptInviteAction(token);
              }}
            >
              <Button type="submit" data-testid="accept-invite">
                Accept invitation
              </Button>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}
