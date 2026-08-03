import { formatPaiseINR, paise } from "@desiauction/core";
import { Button, ButtonLink, Card } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { formatDate } from "../../../lib/format-date";
import { formatPhone } from "../../../lib/format-phone";
import { currentSession, logoutToAction } from "../../../server/auth/actions";
import {
  acceptOwnerJoin,
  ownerJoinLandingView,
  type OwnerJoinPreview,
} from "../../../server/auction/owner-actions";
import "../../orgs/orgs.css";
import "../../join/join.css";

export const metadata = { title: "Team owner invitation · DesiAuction" };

// THE OWNER INVITATION LANDING (M-IP4-3).
//
// Acceptance = org membership (identity side) + the AcceptOwnerInvite COMMAND
// (auction side). It does NOT hand over a paddle — the organizer grants that
// separately, and this page has always been the one place in the product that
// said so honestly. What it did not say: which organization the invitee was
// joining, how much money they were about to be handed, how big a squad they
// were committing to, that the auction had already started, when the link
// expired, or that it worked once. That is the disclosure below.
//
// TODO(founder): should an owner invitation be BOUND to a phone number at mint
// time? Binding buys immunity to forwarding — the failure that put a stranger
// on Demo Wolves — at the cost of an organizer who mistypes one digit minting a
// link nobody can use. Today the link is an unaddressed bearer token and the
// page says so out loud. Not decided here.

export default async function OwnerJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=/owner-join/${token}`);
  }
  const { landing, viewerPhone } = await ownerJoinLandingView(token);

  const switchAccount = async () => {
    "use server";
    await logoutToAction(`/login?next=/owner-join/${token}`);
  };

  return (
    <main className="join">
      <div className="join-panel">
        {landing.state === "valid" ? (
          <ValidOwnerInvite preview={landing.preview} token={token} />
        ) : landing.state === "already-owner" ? (
          <>
            <h1>You already own {landing.teamName}</h1>
            <Card data-testid="owner-join-already-owner">
              <p>
                You&apos;ve already accepted this invitation, so there&apos;s nothing left to
                accept. Your organizer grants your paddle separately — until they do, you can be in
                the room but you cannot bid.
              </p>
              <div className="join-actions">
                <ButtonLink
                  href={`/seasons/${landing.competitionSlug}/auction/live`}
                  size="lg"
                  data-testid="owner-join-go-to-room"
                >
                  Go to the auction room
                </ButtonLink>
              </div>
            </Card>
          </>
        ) : (
          <>
            <h1>Team owner invitation</h1>
            <Card>
              {/* Unknown, expired, revoked, already-claimed and
                  auction-is-over all reach this one sentence, deliberately. */}
              <p role="alert">
                This invitation is no longer valid. It may have been used, expired, or withdrawn —
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

        <form action={switchAccount} className="join-identity">
          <span>Signed in as {formatPhone(viewerPhone)}. Not you?</span>{" "}
          <button type="submit" className="join-linkbutton" data-testid="owner-join-switch-account">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}

function ValidOwnerInvite({ preview, token }: { preview: OwnerJoinPreview; token: string }) {
  // "Demo Premier League Auction (Demo Premier League)" — the same words twice,
  // one set in brackets. The auction is almost always named "<Competition>
  // Auction", so the competition is only worth naming when it is NOT already
  // contained in the auction's own name.
  const auctionNamesCompetition = preview.auctionName
    .toLowerCase()
    .includes(preview.competitionName.toLowerCase());
  const isLive = preview.auctionStatus === "live" || preview.auctionStatus === "paused";

  return (
    <>
      <h1>Own a team</h1>
      <Card data-testid="owner-join-card">
        {/* THE TEAM NAME is the most important word on this card and used to be
            its least prominent element, set inside a pill-sized Badge. */}
        <p className="join-lead">You&apos;ve been invited to own</p>
        <strong className="join-subject" data-testid="owner-join-team">
          {preview.teamName}
        </strong>
        <p className="join-subject-meta">
          in {preview.auctionName}
          {auctionNamesCompetition ? "" : ` · ${preview.competitionName}`} · run by{" "}
          <strong>{preview.orgName}</strong>
        </p>

        {isLive ? (
          <p className="join-live-notice" role="status" data-testid="owner-join-live-notice">
            <strong>This auction is already live.</strong> Players may already have been sold.
            Accepting now puts you into a night that has started.
          </p>
        ) : null}

        {/* WHAT YOU'RE ACCEPTING — money authority, stated before it is taken
            on. Nothing on this page previously named a rupee figure. */}
        <section className="join-disclosure" aria-labelledby="owner-join-disclosure-title">
          <h2 id="owner-join-disclosure-title">What you&apos;re accepting</h2>
          <ul>
            <li data-weight="strong" data-testid="owner-join-purse">
              {formatPaiseINR(paise(preview.pursePerTeam))} purse to bid with — you owe what you
              spend
            </li>
            <li>A squad of up to {preview.squadMax} players</li>
            <li>You also become a member of {preview.orgName} — the club running this season</li>
            <li>
              Invited by{" "}
              {preview.invitedByName === null ? "this season's organizer" : preview.invitedByName}
            </li>
            <li>This link works once — accepting uses it up</li>
            <li>It expires {formatDate(preview.expiresAt)}</li>
            <li>
              Anyone holding this link can accept it — it isn&apos;t tied to your number, so
              don&apos;t forward it
            </li>
          </ul>
        </section>

        <p>
          Accepting makes you this team&apos;s owner. It does <strong>not</strong> give you a
          paddle: the organizer grants that separately, and you claim it in the live room. Until
          then you cannot bid.
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
          {/* `lg` (52px): the second of the two 40px CTAs in the growth loop. */}
          <Button type="submit" size="lg" data-testid="accept-owner-invite">
            Accept — own {preview.teamName}
          </Button>
        </form>

        {/* A real decline would set `declined_at`, which is a migration and out
            of scope here. So this is an exit, honestly labelled. */}
        <p className="join-decline">
          <a href="/home" data-testid="owner-join-decline">
            This isn&apos;t for me
          </a>{" "}
          — leaving does nothing to the link. Tell the organizer: an owner link cannot be withdrawn
          once sent.
        </p>
      </Card>
    </>
  );
}
