import { ScoringSignOutForm } from "../../../components/scoring-sign-out-form";
import Link from "next/link";
import { ButtonLink, Card } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { formatDate } from "../../../lib/format-date";
import { roleHelp, roleLabel } from "../../../lib/invite-roles";
import { currentSession, logoutToAction } from "../../../server/auth/actions";
import { acceptInviteAction, inviteLandingView } from "../../../server/orgs/actions";
import type { InvitePreview } from "../../../server/orgs/invites";
import { TEAM_ENTRY_CODE } from "../../../server/competition/team-entry-code";
import { entryCompetitionByCode } from "../../../server/competition/team-entry-resolver";
import { TeamEntryForm } from "./team-entry-form";
import { AcceptInviteButton } from "./accept-button";
import "../../orgs/orgs.css";
import "../join.css";

export const metadata = { title: "Join" };

// THE INVITATION LANDING.
//
// This is the highest-trust moment in the product: one person hands another
// authority over a club. The page used to state that authority as a database
// enum — "You've been invited to Demo Club as ORG:STAFF" — and said nothing at
// all about who was inviting, what the role could do, when the link died, or
// that it worked once. Everything below is that disclosure. The cryptography
// underneath (one-time, hashed, atomically claimed, byte-identical failures for
// unknown/expired/revoked) is untouched.

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await currentSession();
  if (session === null) {
    // Anonymous stays a real redirect — the login flow carries `next` back here.
    redirect(`/login?next=/join/${token}`);
  }
  if (TEAM_ENTRY_CODE.test(token)) {
    const season = await entryCompetitionByCode(token);
    return (
      <main className="join">
        <div className="join-panel">
          <h1>{season === null ? "Team sign-up unavailable" : `Join ${season.name}`}</h1>
          <Card>
            {season === null ? (
              <p role="alert">
                This team sign-up link is unavailable. Ask the organizer for a current link.
              </p>
            ) : (
              <TeamEntryForm code={token} />
            )}
          </Card>
        </div>
      </main>
    );
  }
  const { landing, viewerLabel } = await inviteLandingView(token);

  // "Not you?" — an invite link is a bearer token, and the handset that opens
  // it is often signed in as somebody else. Returns to THIS link afterwards.
  const switchAccount = async () => {
    "use server";
    await logoutToAction(`/login?next=/join/${token}`);
  };

  return (
    <main className="join">
      <div className="join-panel">
        {landing.state === "valid" ? (
          <ValidInvite preview={landing.preview} token={token} />
        ) : landing.state === "already-member" ? (
          <>
            <h1>You&apos;re already in</h1>
            <Card data-testid="join-already-member">
              {/* The single most likely repeat interaction on this route: the
                  message is still in their WhatsApp and they tap it again. The
                  product knew they were a member and told them the opposite. */}
              <p>
                You&apos;ve already used this invitation to join <strong>{landing.orgName}</strong>.
                There&apos;s nothing left to accept — the link did its job.
              </p>
              <div className="join-actions">
                <ButtonLink href={`/org/${landing.orgSlug}`} size="lg" data-testid="join-go-to-org">
                  Go to {landing.orgName}
                </ButtonLink>
              </div>
            </Card>
          </>
        ) : (
          <>
            <h1>Join an organization</h1>
            <Card>
              {/* Unknown, expired, revoked and already-claimed-by-someone-else
                  all reach this one sentence, deliberately. */}
              <p role="alert">
                This invite link is no longer valid. It may have been used, expired, or withdrawn —
                ask the organizer for a fresh one.
              </p>
              <div className="join-actions">
                <ButtonLink href="/home" variant="secondary" size="touch">
                  Go to Home
                </ButtonLink>
              </div>
            </Card>
          </>
        )}

        <ScoringSignOutForm logout={switchAccount} className="join-identity">
          <span>Signed in as {viewerLabel}. Not you?</span>{" "}
          <button type="submit" className="join-linkbutton" data-testid="join-switch-account">
            Sign out
          </button>
        </ScoringSignOutForm>
      </div>
    </main>
  );
}

function ValidInvite({ preview, token }: { preview: InvitePreview; token: string }) {
  const help = roleHelp(preview.capabilitySet);
  return (
    <>
      <h1>Join {preview.orgName}</h1>
      <Card data-testid="join-card">
        <p className="join-lead">
          You&apos;ve been invited to <strong>{preview.orgName}</strong> as{" "}
          <strong data-testid="join-role">{roleLabel(preview.capabilitySet)}</strong>.
        </p>

        {/* WHAT YOU'RE ACCEPTING. Authority, stated before it is taken on. */}
        <section className="join-disclosure" aria-labelledby="join-disclosure-title">
          <h2 id="join-disclosure-title">What you&apos;re accepting</h2>
          <ul>
            {help === null ? null : <li data-testid="join-role-help">{help}</li>}
            <li>
              Invited by{" "}
              {preview.invitedByName === null
                ? "someone at this organization"
                : preview.invitedByName}
            </li>
            <li>This link works once — accepting uses it up</li>
            <li>It expires {formatDate(preview.expiresAt)}</li>
            <li>Anyone holding this link can use it, so don&apos;t forward it</li>
          </ul>
        </section>

        <form
          action={async () => {
            "use server";
            await acceptInviteAction(token);
          }}
        >
          <AcceptInviteButton />
        </form>

        {/* DECLINE, honestly labelled. A real decline would set `declined_at`,
            which is a migration and out of scope for this work — so this is an
            exit, not a state change, and it does not claim to kill the link. */}
        <p className="join-decline">
          <Link href="/home" data-testid="join-decline">
            This isn&apos;t for me
          </Link>{" "}
          — leaving does nothing to the link; ask the organizer to revoke it.
        </p>
      </Card>
    </>
  );
}
