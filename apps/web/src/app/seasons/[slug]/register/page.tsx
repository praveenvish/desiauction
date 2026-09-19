import {
  attributeOptions,
  entryCategoryLabel,
  isRejectionReason,
  roleLabelIn,
  sportPackFor,
} from "@desiauction/core";
import {
  Badge,
  ButtonLink,
  Card,
  IconArrowRight,
  IconCamera,
  IconLock,
  IconUsers,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { env } from "../../../../env";
import { currentSession } from "../../../../server/auth/actions";
import { ownPhotoUrl, playerProfileFor, sportProfileFor } from "../../../../server/player/profile";
import { registrationLanding, registrationPreview } from "../../../../server/competition/actions";
import { REASON_TO_PLAYER } from "../../../../server/competition/registration-notify";
import { dateRange } from "../../../tournaments/season-card";
import { RegisterFlow } from "./register-flow";
import { RegistrationStatus } from "./registration-status";
import "../../seasons.css";
import "./register.css";

export const metadata = { title: "Register · DesiAuction" };

/** The season's own line under its name: "1 Aug – 15 Sep 2026 · Malad, Mumbai". */
function seasonMeta(
  preview: { startsOn: string | null; endsOn: string | null; location: string | null } | null,
): string | null {
  if (preview === null) {
    return null;
  }
  const parts = [dateRange(preview.startsOn, preview.endsOn), preview.location].filter(
    (part): part is string => part !== null && part !== "",
  );
  return parts.length === 0 ? null : parts.join(" · ");
}

/** One frame for every state of the page: kicker, the season's name, its line. */
function RegisterFrame({
  season,
  meta,
  children,
}: {
  season: string | null;
  meta: string | null;
  children: ReactNode;
}) {
  return (
    <main className="register">
      <div className="register-panel">
        <header className="reg-hero">
          <p className="reg-kicker">Player registration</p>
          <h1>{season ?? "Player registration"}</h1>
          {meta !== null ? <p className="reg-meta">{meta}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
}

// PX-5: the player registration experience. Steps are DERIVED from server
// truth (phone → people.phone, name → people.name, submission → registrations
// row); the only client draft is the pre-submit "How you play" answers, kept
// device-local so refresh and browser restarts resume mid-flow. Status view =
// the same page, post-submit, and the same panel the wizard shows on success.
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  // Share attribution: the `?ref` carried from a shared link (bounded
  // server-side at submit). It rides the login hop inside `next`, and the
  // in-page mobile step never leaves this URL, so it survives both.
  const source = typeof ref === "string" ? ref : "";
  const here =
    source === ""
      ? `/seasons/${slug}/register`
      : `/seasons/${slug}/register?ref=${encodeURIComponent(source)}`;
  const session = await currentSession();
  if (session === null) {
    // DA-35: the share link was a login wall that never named the tournament.
    // A PUBLIC season now shows what it is, when it is, and what will be
    // asked; verify to submit, not to look. A private season keeps the
    // redirect: its name is not a stranger's to read.
    const preview = await registrationPreview(slug);
    if (preview === null) {
      redirect(`/login?next=${encodeURIComponent(here)}`);
    }
    /*
     * The button names the door it opens. It promised "Verify my mobile" while
     * /login opened on EMAIL (LOGIN_DEFAULT_METHOD, until SMS is live) — the
     * first thing a player met after the promise was a field for something
     * else. The mobile number is still asked for, inside the wizard.
     */
    const byEmail = env.LOGIN_DEFAULT_METHOD === "email";
    return (
      <RegisterFrame season={preview.competitionName} meta={seasonMeta(preview)}>
        <Card data-testid="register-preview" className="reg-preview" elevation="floating">
          {preview.open ? (
            <>
              <div className="reg-preview-lede">
                <Badge tone="success">Registration open</Badge>
                {/* PI-1: the category, before anyone signs in — a mismatch
                    should never be discovered after a code. */}
                {preview.entryCategory !== "open" ? (
                  <Badge tone="info" data-testid="register-category">
                    {entryCategoryLabel(preview.entryCategory)} season
                  </Badge>
                ) : null}
              </div>
              <p className="reg-preview-pitch">
                Join the player pool — on auction day, team owners bid to sign you.
              </p>
              <h2 className="reg-preview-head">What you&apos;ll need</h2>
              <ul className="reg-needs">
                <li>
                  <IconCamera size={20} />
                  <span>
                    <strong>Your name and a photo</strong>
                    <span>Photo optional — both appear on the season&apos;s public page</span>
                  </span>
                </li>
                <li>
                  <IconLock size={20} />
                  <span>
                    <strong>Your mobile number</strong>
                    <span>For the organizer only — never published</span>
                  </span>
                </li>
                <li>
                  <IconUsers size={20} />
                  <span>
                    <strong>How you play</strong>
                    <span>Your role; age and styles if you like</span>
                  </span>
                </li>
              </ul>
              <ButtonLink
                href={`/login?next=${encodeURIComponent(here)}`}
                size="lg"
                className="reg-preview-cta"
                data-testid="register-verify-cta"
              >
                {byEmail ? "Continue with email" : "Continue with your mobile"}
                <IconArrowRight size={18} />
              </ButtonLink>
              <p className="reg-preview-foot">
                {byEmail
                  ? "We'll email you a one-time code — no password. "
                  : "We'll text you a one-time code — no password. "}
                Nothing is submitted until you confirm, and you can withdraw any time.{" "}
                <Link href="/help/whats-public">What&apos;s public about you</Link>
              </p>
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
      </RegisterFrame>
    );
  }
  const landing = await registrationLanding(slug);
  if (landing === null) {
    return (
      <RegisterFrame season={null} meta={null}>
        <Card>
          <p role="alert">This season is not available.</p>
        </Card>
      </RegisterFrame>
    );
  }
  const [preview, photoUrl] = await Promise.all([
    registrationPreview(slug),
    ownPhotoUrl(session.personId),
  ]);
  const meta = seasonMeta(preview);
  const pack = sportPackFor(landing.sport);

  if (landing.mine !== null) {
    const mine = landing.mine;
    return (
      <RegisterFrame season={landing.competitionName} meta={meta}>
        <RegistrationStatus
          competitionName={landing.competitionName}
          slug={landing.slug}
          listed={landing.listed}
          status={mine.status}
          number={mine.number}
          name={session.name ?? ""}
          photoUrl={photoUrl}
          roleLabel={mine.role === null ? null : roleLabelIn(pack, mine.role)}
          // NEVER THE RAW COLUMN. The organizer's words must not reach the
          // player (invariant 6); a value outside the closed enum gets a
          // generic sentence that cannot leak.
          rejectionReason={
            mine.status !== "rejected" || mine.rejectionReason === null
              ? null
              : isRejectionReason(mine.rejectionReason)
                ? REASON_TO_PLAYER[mine.rejectionReason]
                : "the organizer did not approve this registration"
          }
        />
      </RegisterFrame>
    );
  }

  if (!landing.open) {
    return (
      <RegisterFrame season={landing.competitionName} meta={meta}>
        <Card>
          <p role="alert" data-testid="registration-closed">
            Registration for <strong>{landing.competitionName}</strong> is not open right now.
          </p>
          {/* Only published seasons HAVE a season page; offering it for an
              unpublished one sends the player to a 404. */}
          {landing.listed ? (
            <p className="register-hint">
              <ButtonLink href={`/c/${slug}`} variant="ghost">
                Back to the season page
              </ButtonLink>
            </p>
          ) : null}
        </Card>
      </RegisterFrame>
    );
  }

  // PI-1: the person-level defaults that prefill "How you play" — from how
  // this person plays THIS season's sport, so a football season offers their
  // football answers and the cricket ones stay where they belong.
  const [personProfile, sportProfile] = await Promise.all([
    playerProfileFor(session.personId),
    sportProfileFor(session.personId, landing.sport),
  ]);
  return (
    <RegisterFrame season={landing.competitionName} meta={meta}>
      <RegisterFlow
        slug={slug}
        competitionName={landing.competitionName}
        listed={landing.listed}
        // Null for an email-only account (0062): the wizard opens on a
        // "Mobile" step instead of sending them to /account and losing them.
        phone={session.phone}
        initialName={session.name ?? ""}
        initialPhotoUrl={photoUrl}
        source={source}
        // The season's sport decides what a role is — see `RegisterFlow`.
        roles={pack.roles.values.map((value) => ({ key: value.key, label: value.label }))}
        // …and what else is worth asking. The same plain-data projection
        // `/account`'s sport panel renders, so both places ask the same things.
        attributes={attributeOptions(landing.sport)}
        profileDefaults={{
          role: sportProfile.defaultRole ?? "",
          dob: personProfile.dateOfBirth ?? "",
          attributes: sportProfile.attributes,
        }}
      />
    </RegisterFrame>
  );
}
