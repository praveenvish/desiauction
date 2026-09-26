import {
  attributeOptions,
  entryCategoryLabel,
  formatAmount,
  paise,
  isRejectionReason,
  roleLabelIn,
  sportPackFor,
} from "@desiauction/core";
import { Badge, ButtonLink, Card, IconCamera, IconLock, IconUsers } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache, type ReactNode } from "react";

import { env } from "../../../../env";
import { currentSession } from "../../../../server/auth/actions";
import { ownPhotoUrl, playerProfileFor, sportProfileFor } from "../../../../server/player/profile";
import {
  registrationLanding,
  registrationPreview,
  type RegistrationPreview,
} from "../../../../server/competition/actions";
import { notificationSettings } from "../../../../server/messaging/actions";
import {
  myAuctionOutcome,
  publicCompetitionView,
  publicTopBuys,
} from "../../../../server/competition/public";
import { TopBuysPodium } from "../../../c/top-buys";
import { SHARE_IMAGE_SIZE } from "../../../c/[slug]/share-image-card";
import { REASON_TO_PLAYER } from "../../../../server/competition/registration-notify";
import { dateRange } from "../../../tournaments/season-card";
import { RegisterFlow } from "./register-flow";
import { RegistrationStatus } from "./registration-status";
import { VerifyStep } from "./verify-step";
import "../../seasons.css";
import "./register.css";

/**
 * THE LINK ORGANIZERS ACTUALLY SHARE.
 *
 * `/seasons/<slug>/register` is what goes into the WhatsApp group, and it
 * previewed as "Register · DesiAuction" with no picture — the one link whose
 * whole job is to be tapped by strangers said nothing about what it opens.
 *
 * `publicCompetitionView` is the same visibility gate `/c/<slug>` and its
 * share card use: a PRIVATE season returns null and keeps the generic title,
 * because its name is not a stranger's to read (the page itself redirects
 * them to sign in for the same reason). A public season borrows its public
 * card image rather than rendering a second one. Not indexed either way —
 * the canonical page for a season is `/c/<slug>`.
 */
/** Metadata and the closed door both read it; one query per request. */
const seasonView = cache(publicCompetitionView);

const FINISHED_AUCTION = new Set(["completed", "reconciled"]);

/**
 * THE CLOSED DOOR, WITH SOMEWHERE TO GO.
 *
 * "Registration for TPL 2026 is not open right now" was the whole page for a
 * visitor who followed an old WhatsApp link the morning after the auction —
 * true, and a dead end: "right now" even hinted it might reopen. When the
 * auction is done the page says so, and offers the two things that visitor can
 * still do: see how the squads came out, or find a tournament that IS open.
 * The squads link needs the public season page; `view` is null otherwise.
 */
async function ClosedNotice({
  slug,
  season,
  listed,
}: {
  slug: string;
  season: string;
  listed: boolean;
}) {
  const view = await seasonView(slug);
  const done = view !== null && FINISHED_AUCTION.has(view.auctionStatus ?? "");
  if (done) {
    // Here's how it ended: the podium, not just a sentence and two buttons.
    const buys = await publicTopBuys(slug);
    return (
      <div className="reg-closed">
        <p role="alert" data-testid="registration-closed" className="reg-closed-line">
          Registration for <strong>{season}</strong> is closed — the auction is done. Here&apos;s
          how it ended.
        </p>
        {buys.length > 0 ? <TopBuysPodium slug={slug} buys={buys} unit={view.auctionUnit} /> : null}
        <p className="reg-closed-actions">
          <ButtonLink href={`/c/${slug}#players-heading`} data-testid="registration-closed-squads">
            See the squads
          </ButtonLink>
          <ButtonLink href="/c" variant="secondary">
            Find an open tournament
          </ButtonLink>
        </p>
      </div>
    );
  }
  return (
    <>
      <p role="alert" data-testid="registration-closed">
        Registration for <strong>{season}</strong> is not open right now.
      </p>
      {/* Only published seasons HAVE a season page; offering it for an
          unpublished one sends the player to a 404. */}
      {listed ? (
        <p className="register-hint">
          <ButtonLink href={`/c/${slug}`} variant="ghost">
            Back to the season page
          </ButtonLink>
        </p>
      ) : null}
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await seasonView(slug);
  if (view === null) {
    return { title: "Register · DesiAuction", robots: { index: false, follow: false } };
  }
  const title = `Register for ${view.name}`;
  const description = view.open
    ? `Join the player pool for ${view.name} — on auction day, team owners bid to sign you.`
    : `${view.name} on DesiAuction.`;
  const card = `${env.PUBLIC_BASE_URL}/c/${view.slug}/opengraph-image`;
  return {
    title: `${title} · DesiAuction`,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: `${env.PUBLIC_BASE_URL}/c/${view.slug}` },
    openGraph: {
      title,
      description,
      url: `${env.PUBLIC_BASE_URL}/seasons/${view.slug}/register`,
      type: "website",
      siteName: "DesiAuction",
      images: [{ url: card, ...SHARE_IMAGE_SIZE, alt: `${view.name} on DesiAuction` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [card] },
  };
}

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

/**
 * WHAT THE SEASON ASKS FOR, BESIDE THE FORM THAT ASKS IT.
 *
 * It was the whole signed-out card, above a button that left for /login. Now
 * the form is on this page, so this is context: on a laptop a column beside
 * the wizard, on a phone one line above it (the full list would push the first
 * field below the fold). Both render; `display:none` keeps exactly one in the
 * accessibility tree at any width.
 */
function SeasonSummary({
  entryCategory,
  open,
}: {
  entryCategory: RegistrationPreview["entryCategory"];
  open: boolean;
}) {
  return (
    <aside className="reg-season" aria-label="About this registration">
      <div className="reg-preview-lede">
        {open ? <Badge tone="success">Registration open</Badge> : null}
        {/* PI-1: the category, before anyone signs in — a mismatch should
            never be discovered after a code. */}
        {entryCategory !== "open" ? (
          <Badge tone="info" data-testid="register-category">
            {entryCategoryLabel(entryCategory)} season
          </Badge>
        ) : null}
      </div>
      <p className="reg-preview-pitch">
        Join the player pool — on auction day, team owners bid to sign you.
      </p>
      <p className="reg-needs-line">
        You&apos;ll need your name, a photo if you like, your mobile and how you play — about a
        minute.
      </p>
      <div className="reg-needs-block">
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
        <p className="reg-preview-foot">
          Nothing is submitted until you confirm, and you can withdraw any time.{" "}
          <Link href="/help/whats-public">What&apos;s public about you</Link>
        </p>
      </div>
    </aside>
  );
}

/**
 * One frame for every state of the page: kicker, the season's name, its line.
 * With an `aside` it becomes the two-column sheet — the season's summary on
 * the left, the wizard on the right — so the page a visitor verifies on is the
 * page they finish on.
 */
function RegisterFrame({
  season,
  meta,
  aside,
  children,
}: {
  season: string | null;
  meta: string | null;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="register">
      <div className="register-panel" data-layout={aside === undefined ? "single" : "sheet"}>
        <header className="reg-hero">
          <p className="reg-kicker">Player registration</p>
          <h1>{season ?? "Player registration"}</h1>
          {meta !== null ? <p className="reg-meta">{meta}</p> : null}
        </header>
        {aside}
        <div className="reg-main">{children}</div>
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
    if (!preview.open) {
      return (
        <RegisterFrame season={preview.competitionName} meta={seasonMeta(preview)}>
          <Card data-testid="register-preview" className="reg-preview" elevation="floating">
            {/* A preview exists only for a published season, so it is listed. */}
            <ClosedNotice slug={slug} season={preview.competitionName} listed />
          </Card>
        </RegisterFrame>
      );
    }
    /*
     * INLINE VERIFICATION (wow pass, founder-approved). The share link used to
     * end in a button to /login and a hope that the visitor found their way
     * back. The code is now step 1 of this page's own wizard, posting to the
     * same server actions /login uses with `next` = this URL (ref included),
     * so the session, the rate limits and the terms consent are exactly
     * /login's. The door opens on LOGIN_DEFAULT_METHOD — email until SMS is
     * live — and the other one is a tap away.
     */
    return (
      <RegisterFrame
        season={preview.competitionName}
        meta={seasonMeta(preview)}
        aside={<SeasonSummary entryCategory={preview.entryCategory} open />}
      >
        <Card data-testid="register-preview" className="reg-card" elevation="floating">
          <VerifyStep next={here} defaultMethod={env.LOGIN_DEFAULT_METHOD} />
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
    // Only an approved player can have been in the room.
    const outcome =
      mine.status === "approved" ? await myAuctionOutcome(slug, session.personId) : null;
    const auction =
      outcome === null || outcome.outcome === "pool"
        ? null
        : {
            outcome: outcome.outcome,
            teamName: outcome.teamName,
            // The public team page exists only for a published season; a
            // private season's player finds their squad on their own page.
            squadHref:
              landing.listed && outcome.teamSlug !== null
                ? `/c/${slug}/t/${outcome.teamSlug}`
                : "/me",
            priceLabel:
              outcome.pricePaise === null
                ? null
                : formatAmount(paise(outcome.pricePaise), outcome.unit),
            orgName: outcome.orgName,
          };
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
          auction={auction}
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
          <ClosedNotice slug={slug} season={landing.competitionName} listed={landing.listed} />
        </Card>
      </RegisterFrame>
    );
  }

  // PI-1: the person-level defaults that prefill "How you play" — from how
  // this person plays THIS season's sport, so a football season offers their
  // football answers and the cricket ones stay where they belong.
  const [personProfile, sportProfile, settings] = await Promise.all([
    playerProfileFor(session.personId),
    sportProfileFor(session.personId, landing.sport),
    notificationSettings(),
  ]);
  return (
    <RegisterFrame
      season={landing.competitionName}
      meta={meta}
      {...(preview === null
        ? {}
        : { aside: <SeasonSummary entryCategory={preview.entryCategory} open /> })}
    >
      <RegisterFlow
        verifiedLead
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
        initialLanguage={settings?.language ?? "en"}
      />
    </RegisterFrame>
  );
}
