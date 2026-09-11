import {
  entryCategoryLabel,
  isRejectionReason,
  roleLabelIn,
  sportPackFor,
} from "@desiauction/core";
import { Badge, ButtonLink, Card } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../../../server/auth/actions";
import { playerProfileFor, sportProfileFor } from "../../../../server/player/profile";
import { registrationLanding, registrationPreview } from "../../../../server/competition/actions";
import { REASON_TO_PLAYER } from "../../../../server/competition/registration-notify";
import { dateRange } from "../../../tournaments/season-card";
import { RegisterFlow } from "./register-flow";
import { WithdrawRegistration } from "./withdraw-registration";
import "../../seasons.css";
import "./register.css";

export const metadata = { title: "Register · DesiAuction" };

const STATUS_COPY: Record<
  string,
  { title: string; body: string; tone: "info" | "success" | "warning" | "danger" | "neutral" }
> = {
  submitted: {
    title: "Registration submitted",
    body: "The organizer is reviewing registrations. Check back here — your status updates the moment they decide.",
    tone: "info",
  },
  approved: {
    title: "You're in the player pool",
    body: "The organizer approved your registration. Next stop: auction day, where team owners bid to sign you. The organizer will share when and where.",
    tone: "success",
  },
  // "The season is full for now" is a specific, checkable fact the product does
  // not have: there is no capacity column anywhere in the schema outside
  // `grounds.capacity`, and nothing counts a pool against a limit. Waitlisting
  // is manual organizer triage, for any reason they like — so the copy says
  // that, rather than inventing a cause the player might reasonably act on.
  waitlisted: {
    title: "You're on the waitlist",
    body: "The organizer has put your registration on the waitlist rather than approving it yet. They move waitlisted players into the pool as they decide — keep an eye on this page.",
    tone: "warning",
  },
  rejected: {
    title: "Registration not approved",
    body: "The organizer decided not to approve this registration for this season.",
    tone: "danger",
  },
  withdrawn: {
    title: "Registration withdrawn",
    body: "This registration was withdrawn. If registration is still open you can ask the organizer to reinstate it.",
    tone: "neutral",
  },
  draft: {
    title: "Registration in draft",
    body: "The organizer holds this registration as a draft. Reach them for the next step.",
    tone: "neutral",
  },
};

// PX-5: the player registration experience. Steps are DERIVED from server
// truth (name → people.name, submission → registrations row); the only client
// draft is the pre-submit role choice, kept device-local so refresh and
// browser restarts resume mid-flow. Status view = the same page, post-submit.
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  // Share attribution: the `?ref` carried from a shared link (bounded server-side
  // at submit). Attribution is lost across the login hop for signed-out users —
  // acceptable; we don't touch the open-redirect-sensitive `next` path for it.
  const source = typeof ref === "string" ? ref : "";
  const session = await currentSession();
  if (session === null) {
    // DA-35: the share link was a login wall that never named the tournament —
    // "Sign in to continue where you were headed" over a form a stranger has
    // not been told the purpose of. A PUBLIC season now shows what it is, when
    // it is, and what will be asked; the OTP moves to submission. Verify to
    // submit, not to look. A private season keeps the redirect: its name is
    // not a stranger's to read.
    const preview = await registrationPreview(slug);
    if (preview === null) {
      redirect(`/login?next=/seasons/${slug}/register`);
    }
    return (
      <main className="register">
        <div className="register-panel">
          <h1>Player registration</h1>
          <Card data-testid="register-preview">
            <h2>{preview.competitionName}</h2>
            <p className="register-hint">
              {[
                // Was the raw ISO pair — "2026-08-01 to 2026-10-31" — on the
                // page where a player decides to sign up, while every other
                // surface spells the same range "1 Aug – 31 Oct 2026". One
                // formatter, already shared by the season card and the row.
                dateRange(preview.startsOn, preview.endsOn),
                preview.location,
              ]
                .filter((part): part is string => part !== null && part !== "")
                .join(" · ")}
            </p>
            {preview.open ? (
              <>
                {/* PI-1: the category, before anyone signs in — a mismatch
                    should never be discovered after an OTP. */}
                {preview.entryCategory !== "open" ? (
                  <p className="register-hint" data-testid="register-category">
                    This is a {entryCategoryLabel(preview.entryCategory).toLowerCase()} season —
                    registration checks your profile against it.
                  </p>
                ) : null}
                <p className="register-hint">
                  Registering puts you in this season&apos;s player pool. On auction day, team
                  owners bid to sign you.
                </p>
                {/* "Your name — it appears on the team sheet and the auction
                    stage" describes a room. It is a URL: the name is published
                    on a page anyone with the link can read. Said here, before
                    anyone signs in, and again in full at the moment of
                    submission. */}
                <h3>What you&apos;ll be asked</h3>
                <ul className="register-asks">
                  <li>
                    Your name — published on this season&apos;s public page and on a player page of
                    your own, readable by anyone with the link.
                  </li>
                  <li>
                    Your mobile number — how the organizer reaches you about this season. Never
                    published on any page.
                  </li>
                  <li>
                    Your playing role — batter, bowler, all-rounder or wicket-keeper. Published
                    alongside your name.
                  </li>
                  <li>
                    Optional: your date of birth (your age is published, the date never is), your
                    playing styles, and a photo. Everything optional you give is published too.
                  </li>
                </ul>
                <p className="register-hint">
                  Publication happens once the organizer publishes this season. You can withdraw at
                  any time, which takes your pages down. See our{" "}
                  <Link href="/legal/privacy">privacy policy</Link> and{" "}
                  <Link href="/help/whats-public">what&apos;s public about you</Link>.
                </p>
                <p className="register-hint">
                  Nothing is submitted until you say so. We&apos;ll verify your mobile with a
                  one-time code at that point.
                </p>
                <ButtonLink
                  href={`/login?next=${encodeURIComponent(
                    // Share attribution survives the login hop now: it used to
                    // be dropped, and an arrival with `?ref=whatsapp` was
                    // recorded as "direct" in the audit row.
                    source === ""
                      ? `/seasons/${slug}/register`
                      : `/seasons/${slug}/register?ref=${encodeURIComponent(source)}`,
                  )}`}
                  data-testid="register-verify-cta"
                >
                  Verify my mobile and register
                </ButtonLink>
              </>
            ) : (
              <>
                <p role="alert" data-testid="registration-closed">
                  Registration for <strong>{preview.competitionName}</strong> is not open right now.
                </p>
                <ButtonLink href={`/c/${slug}`} variant="ghost">
                  Back to the season page
                </ButtonLink>
              </>
            )}
          </Card>
        </div>
      </main>
    );
  }
  const landing = await registrationLanding(slug);
  // PI-1: the person-level defaults that prefill step 2 of the wizard.
  const personProfile = await playerProfileFor(session.personId);
  /*
   * Prefilled from how this person plays THIS season's sport (Phase 3).
   * Registering for a football season offers their football answers; the
   * cricket ones stay where they belong and neither overwrites the other.
   */
  const sportProfile =
    landing === null ? null : await sportProfileFor(session.personId, landing.sport);
  return (
    <main className="register">
      <div className="register-panel">
        <h1>Player registration</h1>
        {landing === null ? (
          <Card>
            <p role="alert">This season is not available.</p>
          </Card>
        ) : landing.mine !== null ? (
          <Card data-testid="registration-status">
            <div className="register-status-head">
              <Badge
                tone={STATUS_COPY[landing.mine.status]?.tone ?? "neutral"}
                data-testid="my-registration-status"
              >
                {landing.mine.status}
              </Badge>
              <h2>{STATUS_COPY[landing.mine.status]?.title ?? landing.mine.status}</h2>
            </div>
            <p className="register-hint">
              <strong>{landing.competitionName}</strong> ·{" "}
              {roleLabelIn(sportPackFor(landing.sport), landing.mine.role)} · registration{" "}
              {landing.mine.number}
            </p>
            <p className="register-hint">{STATUS_COPY[landing.mine.status]?.body}</p>
            {/* DA-35: the reason was captured, shipped and rendered nowhere.
                The person it was about was told to "reach the organizer through
                whoever shared the link" — a hearsay chain, for a fact the
                product had. */}
            {landing.mine.status === "rejected" && landing.mine.rejectionReason !== null ? (
              <p className="register-hint" data-testid="my-rejection-reason">
                {/* NEVER THE RAW COLUMN. The fallback here used to echo
                    `rejectionReason` verbatim when it was not one of the five
                    categories. Unreachable today — the column is only ever
                    written from the closed enum — but it is a free-text echo
                    sitting on the one surface invariant 6 is about, and the
                    thing invariant 6 forbids is exactly "the organizer's words
                    reach the player". A generic sentence costs nothing and
                    cannot leak. */}
                <strong>Reason given:</strong>{" "}
                {isRejectionReason(landing.mine.rejectionReason)
                  ? REASON_TO_PLAYER[landing.mine.rejectionReason]
                  : "the organizer did not approve this registration"}
                .
              </p>
            ) : null}
            {/* A player was never shown their own public page. The only link to
                `/c/[slug]/p/[number]` in the entire product was inside the
                showcase dialog on the public page itself — not here, not on
                /home, not in the inbox. They could not see what the world sees,
                and could not check it was right. It is shown here, with the
                address spelled out so it can be copied, and next to the withdraw
                control, which is the takedown lever nobody was told about. */}
            {landing.mine.status === "approved" && landing.listed ? (
              <div className="register-public" data-testid="my-public-page">
                <h3 className="register-public-head">Your public player page</h3>
                <p className="register-hint">
                  You are in the pool for a published season, so this page is live and anyone with
                  the address can read it. It carries your name, number, playing role, age and
                  styles if you gave them, your photo if you added one, and which team signs you —
                  never your mobile number.
                </p>
                <p className="register-public-url">
                  <Link href={`/c/${landing.slug}/p/${landing.mine.number}`}>
                    /c/{landing.slug}/p/{landing.mine.number}
                  </Link>
                </p>
                <p className="register-hint">
                  Open it to see exactly what a stranger sees. If you do not want it published,
                  withdraw below — that removes this page and the preview card that travels with it.
                </p>
              </div>
            ) : null}
            <p className="register-hint">
              <Link href="/home">All your registrations live on Home</Link>.
            </p>
            {landing.mine.status === "submitted" ||
            landing.mine.status === "waitlisted" ||
            landing.mine.status === "approved" ? (
              <WithdrawRegistration slug={slug} />
            ) : null}
          </Card>
        ) : !landing.open ? (
          <Card>
            <p role="alert" data-testid="registration-closed">
              Registration for <strong>{landing.competitionName}</strong> is not open right now.
            </p>
            {/* Only published seasons HAVE a season page. Offering this for an
                unpublished one sends the player to a 404 — which is exactly
                what an unpublished season is supposed to look like, and a dead
                end for someone who was told to click it. */}
            {landing.listed ? (
              <p className="register-hint">
                <ButtonLink href={`/c/${slug}`} variant="ghost">
                  Back to the season page
                </ButtonLink>
              </p>
            ) : null}
          </Card>
        ) : session.phone === null ? (
          /*
           * SIGNED IN BY EMAIL, WITH NO NUMBER (0062).
           *
           * Said here rather than letting them fill in three steps and meet a
           * refusal at Submit. A player is reached by SMS and by nothing else —
           * the approval, the auction-day summons, the sold message — so a
           * registration with no number would be accepted, approved, auctioned
           * and never announced to the one person it is about.
           * `submitRegistration` refuses it at the server too; this is the half
           * that gives them somewhere to go.
           */
          <Card>
            <p role="alert" data-testid="registration-needs-phone">
              Add a mobile number to your account before you register as a player.
            </p>
            <p className="register-hint">
              Organizers text you about your registration and again on auction day, and that is the
              only way they reach you — so a season entry needs a number we can use. It takes a
              minute: we send a six-digit code to confirm the handset is yours.
            </p>
            <p className="register-hint">
              <ButtonLink href="/account">Add your mobile number</ButtonLink>
            </p>
          </Card>
        ) : (
          <RegisterFlow
            slug={slug}
            competitionName={landing.competitionName}
            phone={session.phone}
            initialName={session.name ?? ""}
            source={source}
            // The season's sport decides what a role is — see `RegisterFlow`.
            roles={sportPackFor(landing.sport).roles.values.map((value) => ({
              key: value.key,
              label: value.label,
            }))}
            profileDefaults={{
              role: sportProfile?.defaultRole ?? "",
              dob: personProfile.dateOfBirth ?? "",
              batting: sportProfile?.attributes["batting_style"] ?? "",
              bowling: sportProfile?.attributes["bowling_style"] ?? "",
            }}
          />
        )}
      </div>
    </main>
  );
}
