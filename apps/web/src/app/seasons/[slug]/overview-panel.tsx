"use client";

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  Field,
  Select,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { ENTRY_CATEGORIES, entryCategoryLabel } from "@desiauction/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  advanceCompetitionAction,
  cloneCompetitionAction,
  setCompetitionVisibilityAction,
  updateCompetitionDetailsAction,
  type DetailsField,
  type SeasonOverviewView,
} from "../../../server/competition/actions";
import { formatDate } from "../../../lib/format-date";
import { roleLabel } from "../../../lib/playing-roles";
import { track } from "../../../lib/telemetry";
import { CompetitionLogoUploader } from "./competition-logo-uploader";
import { ShareRegistration } from "./registrations/share-registration";

/**
 * The Season Workspace overview (PX design "Season Workspace").
 *
 * A dashboard, not a desk: everything here READS. The work — adding teams,
 * triaging registrations, running the auction — lives in the tabs above, which
 * are full workspaces of their own. The exceptions earn their place because
 * they are statements about the season as a whole rather than about any one
 * tab: advancing the lifecycle (hosted by the stepper, which IS the lifecycle),
 * editing the season's own identity, and publishing the public page — which now
 * has a block of its own rather than riding in the footer of a card about
 * something else.
 */

// The lifecycle rendered as the design's six-step rail (doc 44's one-gate-at-a-
// time, drawn as a whole so an organizer can see what is behind and ahead).
const NEXT_STEP: Record<string, { to: string; label: string } | null> = {
  draft: { to: "setup", label: "Begin setup" },
  setup: { to: "registration_open", label: "Open registration" },
  registration_open: { to: "registration_closed", label: "Close registration" },
  // DA-10: registration_closed is the LAST competition status — the lifecycle
  // continues in the auction, which has its own machine. Offering only
  // "Reopen registration" here made the single forward-looking control on the
  // page point backwards for the whole second half of the season.
  registration_closed: null,
};

/** What just happened, said out loud — every advance used to be silent (DA-16). */
const ADVANCE_ANNOUNCEMENT: Record<string, string> = {
  setup: "Setup begun. Add your teams next.",
  registration_open: "Registration is open. Share the link to recruit players.",
  registration_closed: "Registration closed. The auction is next.",
};

/**
 * Where the season actually goes next once intake is shut (DA-10).
 *
 * `canSettle` is the gate on the last two rungs and it is not optional. The
 * settlement desk is `settlement.view`, which by design is NOT implied by
 * `org:owner` or by `competition.manage` — the capability partition keeps money
 * powers an explicit act of trust. Nothing here honoured that, so the organizer
 * who had just conducted the auction was offered "Open settlement" as the
 * page's primary action and taken to a bare 404. Where the door is locked the
 * ladder now says who holds the key instead of pointing at it.
 */
function nextDestination(
  slug: string,
  auctionStatus: string | null,
  canSettle: boolean,
): { href: string; label: string } | { locked: true } {
  if (auctionStatus === null) {
    return { href: `/seasons/${slug}/auction`, label: "Create the auction" };
  }
  if (auctionStatus === "scheduled") {
    return { href: `/seasons/${slug}/auction`, label: "Open the auction" };
  }
  if (auctionStatus === "live" || auctionStatus === "paused") {
    return { href: `/seasons/${slug}/auction/cockpit`, label: "Enter the auction room" };
  }
  if (!canSettle) {
    return { locked: true };
  }
  if (auctionStatus === "completed") {
    return { href: `/seasons/${slug}/money`, label: "Open settlement" };
  }
  return { href: `/seasons/${slug}/money`, label: "Review settlement" };
}

// Third consumer moved the map to lib/playing-roles — one prose name per role,
// shared with the auction overview and the registration desk.

/**
 * Money the way the tiles show it: crores and lakhs, because a purse reads as
 * "₹6.63 Cr" to everyone who runs one of these. Exact rupees stay on the rows.
 */
function compactINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) {
    return `₹${(rupees / 10_000_000).toFixed(2)} Cr`;
  }
  if (rupees >= 100_000) {
    return `₹${(rupees / 100_000).toFixed(2)} L`;
  }
  return `₹${rupees.toLocaleString("en-IN")}`;
}

function exactINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

const STEP_LABELS = ["Setup", "Teams", "Registration", "Auction", "Fixtures", "Settlement"];

/**
 * The six gates, every one of them derived from data this season actually
 * holds (DA-09).
 *
 * Two of them used to be undeliverable. Rung 5 was the literal `false`, so
 * Fixtures could never tick under any data at all. Rung 6 asked for an auction
 * status of `reconciled` — a value no auction in the database has ever held and
 * no code path can produce, because the auction aggregate's command type
 * structurally excludes the `reconcile` transition. Adding that transition is
 * auction-engine work; deriving the truth is not. Fixtures now reads the
 * season's fixture count, and Settlement reads the settlement case's own
 * discharge — the same fold the money desk renders.
 *
 * The order is the lifecycle's, not the tab strip's: you build the franchises,
 * take entries, hold the auction, schedule the matches, settle the money.
 */
function clearedRungs(view: SeasonOverviewView): boolean[] {
  const status = view.competition.status;
  return [
    status !== "draft",
    view.teamCount > 0,
    status === "registration_closed",
    view.auctionStatus === "completed" || view.auctionStatus === "reconciled",
    view.fixtureCount > 0,
    view.settlement !== null && view.settlement.discharged,
  ];
}

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

/** Where and when, at last: the hero never showed the season's own dates. */
function heroMeta(view: SeasonOverviewView): string[] {
  const { startsOn, endsOn, location } = view.competition;
  const when =
    startsOn !== null && endsOn !== null
      ? `${formatDate(startsOn)} – ${formatDate(endsOn)}`
      : startsOn !== null
        ? `From ${formatDate(startsOn)}`
        : endsOn !== null
          ? `Until ${formatDate(endsOn)}`
          : "Dates not set";
  return [when, location, view.orgName].filter(
    (part): part is string => part !== null && part !== "",
  );
}

/** The hero's secondary action, following the state instead of ignoring it. */
function secondaryAction(
  view: SeasonOverviewView,
  slug: string,
  finished: boolean,
): { href: string; label: string } {
  if (finished) {
    return view.viewer.canSeeMoney
      ? { href: `/seasons/${slug}/money`, label: "View results" }
      : { href: `/seasons/${slug}/teams`, label: "View squads" };
  }
  if (view.teamCount === 0) {
    return { href: `/seasons/${slug}/teams`, label: "Add teams" };
  }
  if (view.pendingPlayers > 0) {
    return {
      href: `/seasons/${slug}/registrations`,
      label: `Review ${String(view.pendingPlayers)} ${view.pendingPlayers === 1 ? "registration" : "registrations"}`,
    };
  }
  if (view.competition.status === "registration_closed" && view.auctionStatus === null) {
    return { href: `/seasons/${slug}/auction`, label: "Set up the auction" };
  }
  return { href: `/seasons/${slug}/fixtures`, label: "Fixtures" };
}

/** What is still missing before this season may open registration (DA-11). */
function missingForRegistration(competition: SeasonOverviewView["competition"]): string[] {
  const missing: string[] = [];
  if (competition.name.trim().length < 3) {
    missing.push("a name");
  }
  if (competition.startsOn === null || competition.endsOn === null) {
    missing.push("dates");
  }
  if (competition.location === null || competition.location.trim() === "") {
    missing.push("a location");
  }
  return missing;
}

export function OverviewPanel({ view, slug }: { view: SeasonOverviewView; slug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // DA-16: every action dropped focus to <body>. The control that started the
  // work takes it back when the work is done — and it can only take it back
  // once the button is no longer `disabled` by its own loading state, which is
  // why this is an effect and not a call at the end of the handler.
  const advanceRef = useRef<HTMLButtonElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const [pendingFocus, setPendingFocus] = useState<"advance" | "publish" | null>(null);

  const status = view.competition.status;
  const step = NEXT_STEP[status] ?? null;
  const onward = nextDestination(slug, view.auctionStatus, view.viewer.canSettle);
  const cleared = clearedRungs(view);
  const activeIndex = cleared.indexOf(false);
  const auctionDone = cleared[3] === true;
  // The enum has no `completed` value (that is a migration), but the fact is
  // derivable: the auction is over and the books are discharged.
  const finished = auctionDone && view.settlement !== null && view.settlement.discharged;
  const missing = missingForRegistration(view.competition);
  const secondary = secondaryAction(view, slug, finished);
  const canPublish = view.publishBlockers.length === 0;

  useEffect(() => {
    if (pendingFocus === null || busy) {
      return;
    }
    (pendingFocus === "advance" ? advanceRef.current : publishRef.current)?.focus();
    setPendingFocus(null);
  }, [pendingFocus, busy, status, view.competition.visibility]);
  const previewable = view.competition.visibility === "public" || status === "registration_open";

  const advance = async () => {
    if (step === null) {
      return;
    }
    setBusy(true);
    const result = await advanceCompetitionAction(
      slug,
      step.to as SeasonOverviewView["competition"]["status"],
    );
    setBusy(false);
    if (result.ok) {
      setBlocked(false);
      toast({ title: ADVANCE_ANNOUNCEMENT[step.to] ?? "Season updated.", tone: "success" });
      router.refresh();
      setPendingFocus("advance");
    } else if (result.needsDetails === true) {
      // Naming three fields the product gave no way to set was the whole of
      // DA-11. The refusal now carries its own repair.
      setBlocked(true);
      setPendingFocus("advance");
    } else {
      toast({ title: result.error ?? "Could not advance.", tone: "danger" });
    }
  };

  // Retention ("run it again"): clone this season into a fresh draft and drop
  // the organizer into next season's setup. Season-level, so it belongs on the
  // lifecycle row rather than in any one tab.
  const runItAgain = async () => {
    setBusy(true);
    const result = await cloneCompetitionAction(slug);
    setBusy(false);
    if (result.ok && result.slug !== undefined) {
      track("competition.cloned");
      toast({ title: "New draft created from this season.", tone: "success" });
      router.push(`/seasons/${result.slug}`);
    } else {
      toast({ title: result.error ?? "Could not duplicate.", tone: "danger" });
    }
  };

  const setVisibility = async (visibility: "private" | "public") => {
    setBusy(true);
    const result = await setCompetitionVisibilityAction(slug, visibility);
    setBusy(false);
    setPublishOpen(false);
    if (result.ok) {
      toast({
        title: visibility === "public" ? "Public page published" : "Public page unpublished",
        tone: "success",
      });
      router.refresh();
      setPendingFocus("publish");
    } else {
      toast({ title: result.error ?? "Could not update.", tone: "danger" });
    }
  };

  return (
    <>
      <header className="season-hero">
        <div className="season-hero-main">
          <div className="season-hero-title">
            <Badge tone={STATUS_TONE[status]} data-testid="competition-status">
              {finished ? "completed" : status.replace(/_/g, " ")}
            </Badge>
            {view.auctionLive ? <span className="season-live-pill">AUCTION LIVE</span> : null}
          </div>
          {/* The dates existed on the row and were never rendered anywhere in
              the workspace — the one fact a season is most often looked up for. */}
          <p className="season-hero-meta" data-testid="season-meta">
            {heroMeta(view).join(" · ")}
          </p>
        </div>
        <div className="season-hero-actions">
          {view.viewer.canManage ? (
            <Button
              variant="ghost"
              data-testid="open-season-settings"
              onClick={() => {
                setSettingsOpen(true);
              }}
            >
              Season details
            </Button>
          ) : null}
          {/* The secondary action used to be "Fixtures" in every state — the
              least useful destination for a draft with no teams. */}
          <ButtonLink href={secondary.href} variant="secondary" data-testid="season-secondary">
            {secondary.label}
          </ButtonLink>
          {view.auctionLive ? (
            <ButtonLink href={`/seasons/${slug}/auction/live`}>Go to live auction →</ButtonLink>
          ) : null}
        </div>
      </header>

      {finished ? (
        <Retrospective view={view} slug={slug} busy={busy} onRunItAgain={runItAgain} />
      ) : (
        <Card className="season-stepper-card" data-testid="lifecycle-panel">
          <p className="season-stepper-summary" data-testid="lifecycle-summary">
            {activeIndex === -1
              ? "All six steps complete"
              : `Step ${String(activeIndex + 1)} of 6 · ${STEP_LABELS[activeIndex] ?? ""}`}
          </p>
          <ol className="season-stepper" aria-label="Season progress">
            {STEP_LABELS.map((label, index) => {
              const state =
                cleared[index] === true ? "done" : index === activeIndex ? "now" : "next";
              return (
                <li
                  key={label}
                  className="season-step"
                  data-state={state}
                  {...(state === "now" ? { "aria-current": "step" as const } : {})}
                >
                  <span className="season-step-mark" aria-hidden>
                    {state === "done" ? "✓" : String(index + 1)}
                  </span>
                  <span className="season-step-label">{label}</span>
                  {/* The only carrier of state used to be aria-hidden, so a
                      screen reader heard six bare nouns and no progress. */}
                  <VisuallyHidden>
                    {state === "done" ? " — done" : state === "now" ? " — in progress" : " — to do"}
                  </VisuallyHidden>
                </li>
              );
            })}
          </ol>
          <div className="season-stepper-actions">
            <Link
              href={`/seasons/${slug}/readiness`}
              className="season-inline-link"
              data-testid="open-readiness"
            >
              Review readiness
            </Link>
            {view.viewer.canManage ? (
              <Button
                variant="ghost"
                size="touch"
                loading={busy}
                data-testid="run-it-again"
                onClick={() => void runItAgain()}
              >
                Run it again
              </Button>
            ) : null}
            {view.viewer.canManage && step !== null ? (
              <Button
                ref={advanceRef}
                size="touch"
                onClick={() => void advance()}
                loading={busy}
                data-testid="advance-status"
              >
                {step.label}
              </Button>
            ) : view.viewer.canManage &&
              status === "registration_closed" &&
              !("locked" in onward) ? (
              <Button
                size="touch"
                onClick={() => {
                  router.push(onward.href);
                }}
                data-testid="advance-status"
              >
                {onward.label}
              </Button>
            ) : null}
            {view.viewer.canManage && status === "registration_closed" && "locked" in onward ? (
              <p className="season-guard" data-testid="settlement-locked">
                <span>
                  The auction is done. Settling it needs money authority for{" "}
                  {view.orgName === "" ? "this club" : view.orgName} — a separate grant from running
                  the season. Ask an owner of the club to give you one under Money &amp; roles.
                </span>
              </p>
            ) : null}
          </div>
          {blocked && missing.length > 0 ? (
            <p className="season-guard" role="alert" data-testid="advance-blocked">
              <span>
                This season still needs {missing.join(", ").replace(/, ([^,]*)$/, " and $1")} before
                registration can open.
              </span>
              <Button
                size="sm"
                variant="secondary"
                data-testid="open-season-settings-guard"
                onClick={() => {
                  setSettingsOpen(true);
                }}
              >
                {missing.includes("dates") ? "Add dates" : "Edit season details"}
              </Button>
            </p>
          ) : null}
        </Card>
      )}

      <div className="season-tiles">
        <div className="season-tile">
          <span className="season-tile-value">{view.approvedPlayers}</span>
          <span className="season-tile-label">Approved players</span>
        </div>
        {view.pendingPlayers > 0 ? (
          <Link
            className="season-tile season-tile-link"
            href={`/seasons/${slug}/registrations`}
            data-testid="pending-tile"
          >
            <span className="season-tile-value season-tile-warn">{view.pendingPlayers}</span>
            <span className="season-tile-label">Awaiting your review →</span>
          </Link>
        ) : null}
        <div className="season-tile">
          <span className="season-tile-value">{view.teamCount}</span>
          <span className="season-tile-label">Teams</span>
        </div>
        {/* Before an auction exists there is no purse and there are no lots —
            two tiles reporting zeroes about a thing that has not been created. */}
        {view.auctionStatus !== null && view.purseCommitted !== undefined ? (
          <div className="season-tile">
            <span className="season-tile-value">{compactINR(view.purseCommitted)}</span>
            {/* The percentage came from a purse nobody set: DEFAULT_AUCTION_CONFIG's
                ₹2 Cr per team, so a real ₹1 L read "<1%" of a denominator no
                organizer ever chose. A figure whose scale is invented is worse
                than no figure. */}
            <span className="season-tile-label">Purse committed</span>
          </div>
        ) : null}
        {view.auctionStatus !== null ? (
          <div className="season-tile">
            <span className="season-tile-value season-tile-accent">
              {view.lotsSold}
              <span className="season-tile-of">/{view.lotsTotal}</span>
            </span>
            <span className="season-tile-label">Lots sold</span>
          </div>
        ) : null}
      </div>

      <div className="season-cards">
        <Card data-testid="team-spend-card">
          <div className="season-card-head">
            <h2>{view.lotsSold > 0 && view.viewer.canSeeMoney ? "Top teams by spend" : "Teams"}</h2>
            <Link className="season-inline-link" href={`/seasons/${slug}/teams`}>
              All teams →
            </Link>
          </div>
          {view.topTeams.length === 0 ? (
            <div className="season-empty">
              <p className="competitions-hint">
                No teams yet. The auction issues one paddle per team, so this is the first thing to
                build.
              </p>
              {view.viewer.canManage ? (
                <ButtonLink href={`/seasons/${slug}/teams`} data-testid="empty-add-teams">
                  Add teams
                </ButtonLink>
              ) : null}
            </div>
          ) : (
            <ul className="season-spend-list">
              {view.topTeams.slice(0, 5).map((team) => (
                <li key={team.teamId} className="season-spend-row">
                  <span className="season-spend-top">
                    <span
                      className="season-spend-dot"
                      style={team.color !== null ? { background: team.color } : undefined}
                      aria-hidden
                    />
                    <span className="season-spend-name">{team.name}</span>
                    {team.squadMax !== undefined && team.squadMax !== null ? (
                      <span className="season-spend-squad">
                        {team.squad}/{team.squadMax}
                      </span>
                    ) : null}
                    {/* Before a hammer has fallen every team has spent ₹0, and
                        a column of "₹0" is furniture, not a reading. */}
                    {team.spend !== undefined && view.lotsSold > 0 ? (
                      <span className="season-spend-amount">{exactINR(team.spend)}</span>
                    ) : null}
                  </span>
                  {/* A bar of zero length is not a reading, it is furniture:
                      three teams at ₹0 drew three empty tracks. */}
                  {team.spend !== undefined && team.spend > 0 ? (
                    <SpendBar spend={team.spend} max={view.topTeams[0]?.spend ?? 0} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="pool-card">
          <div className="season-card-head">
            <h2>Pool by role</h2>
          </div>
          {view.poolByRole.length === 0 ? (
            <div className="season-empty">
              <p className="competitions-hint">
                No approved players yet.{" "}
                {status === "registration_open"
                  ? "Share the registration link — every entry lands in the Registrations tab for you to approve."
                  : "Players enter through the registration link once you open registration."}
              </p>
              {/* This branch only renders while registration is open. */}
              {view.viewer.canReview && status === "registration_open" ? (
                <ShareRegistration slug={slug} open />
              ) : null}
              {view.viewer.canReview && view.pendingPlayers > 0 ? (
                <ButtonLink
                  href={`/seasons/${slug}/registrations`}
                  data-testid="empty-review-registrations"
                >
                  Review {view.pendingPlayers} waiting
                </ButtonLink>
              ) : null}
            </div>
          ) : (
            <ul className="season-pool-list">
              {view.poolByRole.map((entry) => (
                <li key={entry.role} className="season-pool-row">
                  <span className="season-pool-top">
                    <span className="season-pool-name">{roleLabel(entry.role)}</span>
                    <span className="season-pool-count">{entry.count}</span>
                  </span>
                  <span className="season-bar" aria-hidden>
                    <span
                      className="season-bar-fill season-bar-accent"
                      style={{
                        width: `${String(Math.round((entry.count / (view.poolByRole[0]?.count ?? 1)) * 100))}%`,
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* The season's own mark. `competitions.logo_url` has been readable since
          the media platform shipped — the public directory renders it — but no
          screen in the product could ever write it, so every tournament fell
          back to a text monogram. It sits directly above the publish block
          because this is the mark that block puts on the internet, and it is
          one of the identity statements that earn a place on a dashboard: it
          describes the season as a whole rather than any one tab. */}
      {view.viewer.canManage ? (
        <Card className="season-branding-card" data-testid="season-branding">
          <div className="season-card-head">
            <h2>Tournament logo</h2>
          </div>
          <p className="competitions-hint">
            Shown beside this season on the public directory and on its public page. Without one,
            players see the season&rsquo;s initials.
          </p>
          <CompetitionLogoUploader
            slug={slug}
            competitionId={view.competition.id}
            competitionName={view.competition.name}
            {...(view.logoUrl !== null ? { currentUrl: view.logoUrl } : {})}
          />
        </Card>
      ) : null}

      {/* DA-12: publishing gets its own block. It used to be a ghost button in
          the footer of the pool card, one click from the public internet. */}
      <Card className="season-publish-card" data-testid="visibility-row">
        <div className="season-card-head">
          <h2>Public page</h2>
          <Badge tone={view.competition.visibility === "public" ? "success" : "neutral"}>
            {view.competition.visibility === "public" ? "LIVE" : "Not listed"}
          </Badge>
        </div>
        <p className="competitions-hint">
          {view.competition.visibility === "public"
            ? "This season is listed publicly at /c/" + slug + " — anyone can see it and share it."
            : "Publishing puts this season on the public directory, where players and spectators can find it."}
        </p>
        {view.viewer.canManage && !canPublish && view.competition.visibility !== "public" ? (
          <ul className="season-blockers" data-testid="publish-blockers">
            {view.publishBlockers.map((blocker) => (
              <li key={blocker.code} className="season-blocker">
                <span>{blocker.message}</span>
                {blocker.code === "dates" || blocker.code === "location" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid={`fix-${blocker.code}`}
                    onClick={() => {
                      setSettingsOpen(true);
                    }}
                  >
                    {blocker.code === "dates" ? "Add dates" : "Add location"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="season-publish-actions">
          {previewable ? (
            <Link className="season-inline-link" href={`/c/${slug}`} data-testid="open-public-page">
              {view.competition.visibility === "public"
                ? "View the public page →"
                : "Preview the public page →"}
            </Link>
          ) : null}
          {view.viewer.canManage ? (
            <Button
              ref={publishRef}
              size="touch"
              variant={view.competition.visibility === "public" ? "ghost" : "primary"}
              loading={busy}
              disabled={!canPublish && view.competition.visibility !== "public"}
              data-testid="toggle-visibility"
              onClick={() => {
                if (view.competition.visibility === "public") {
                  void setVisibility("private");
                } else {
                  setPublishOpen(true);
                }
              }}
            >
              {view.competition.visibility === "public" ? "Unpublish" : "Publish"}
            </Button>
          ) : null}
        </div>
      </Card>

      <Dialog
        open={publishOpen}
        onClose={() => {
          setPublishOpen(false);
        }}
        title="Publish this season?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPublishOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={busy}
              data-testid="confirm-publish"
              onClick={() => void setVisibility("public")}
            >
              Publish
            </Button>
          </>
        }
      >
        <div className="season-confirm">
          <p>Anyone on the internet will be able to see, at /c/{slug}:</p>
          <ul>
            <li>{view.competition.name}</li>
            <li>{view.competition.location ?? "No location set"}</li>
            <li>{heroMeta(view)[0]}</li>
            <li>
              {view.teamCount} {view.teamCount === 1 ? "team" : "teams"} and {view.approvedPlayers}{" "}
              approved {view.approvedPlayers === 1 ? "player" : "players"}
            </li>
          </ul>
          {previewable ? (
            <p>
              <Link className="season-inline-link" href={`/c/${slug}`} target="_blank">
                Preview it first →
              </Link>
            </p>
          ) : null}
          <p className="competitions-hint">You can unpublish at any time.</p>
        </div>
      </Dialog>

      {view.viewer.canManage ? (
        <SeasonSettingsDialog
          open={settingsOpen}
          slug={slug}
          competition={view.competition}
          onClose={() => {
            setSettingsOpen(false);
          }}
          onSaved={() => {
            setSettingsOpen(false);
            setBlocked(false);
            toast({ title: "Season details saved", tone: "success" });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function SpendBar({ spend, max }: { spend: number; max: number }) {
  return (
    <span className="season-bar" aria-hidden>
      <span
        className="season-bar-fill"
        style={{ width: `${String(max > 0 ? Math.round((spend / max) * 100) : 0)}%` }}
      />
    </span>
  );
}

/**
 * What is true about this season's money, for THIS reader.
 *
 * Two rules, in order. Nothing is claimed about the books that the settlement
 * case does not itself say — `settled`/`closed` are statuses, not the result of
 * `outstanding === 0`. And nothing is said about the books at all to someone
 * who may not open them: a viewer without money sight is told the auction is
 * done, which is true, and nothing further.
 */
function retroLine(view: SeasonOverviewView): string {
  const settlement = view.settlement;
  if (!view.viewer.canSeeMoney) {
    return "This season is over: the auction is done.";
  }
  if (settlement === null) {
    return "This season is over: the auction is done. No settlement case has been opened for it yet.";
  }
  switch (settlement.status) {
    case "closed":
      return "This season is over: the auction is done, the books are settled and the case is closed.";
    case "settled":
      return "This season is over: the auction is done and the books are settled. The case has not been closed yet.";
    case "discrepant":
      return "This season is over, but its books are frozen: the auction log no longer matches what the settlement case pinned.";
    case "settling":
      return settlement.outstanding !== undefined && settlement.outstanding > 0
        ? "This season is over: the auction is done, but the books are still being settled and money is still owed."
        : "This season is over: the auction is done and everything owed has come in, but the books have not been settled yet.";
    default:
      return "This season is over: the auction is done, and its settlement case is still being worked through.";
  }
}

/**
 * A season that is over (DA-14). A half-finished six-step checklist is the
 * wrong shape for something with no next step: what an organizer wants from a
 * finished season is what happened, and the offer to run it again.
 */
function Retrospective({
  view,
  slug,
  busy,
  onRunItAgain,
}: {
  view: SeasonOverviewView;
  slug: string;
  busy: boolean;
  onRunItAgain: () => Promise<void>;
}) {
  const settlement = view.settlement;
  return (
    <Card className="season-stepper-card" data-testid="lifecycle-panel">
      <div className="season-retro">
        {/* The state badge is the hero's job — this line says what it means.
            It used to be a hardcoded sentence that consulted no status at all:
            "the books are settled" was printed over a case sitting in
            `settling`, and printed to a viewer with no settlement grant, who
            gets a 404 on /money. It now reads the case, and says nothing about
            books it may not show. */}
        <p className="season-retro-line" data-testid="season-completed">
          {retroLine(view)}
        </p>
        <dl className="season-retro-figures">
          <div>
            <dt>Lots sold</dt>
            <dd>
              {view.lotsSold} of {view.lotsTotal}
            </dd>
          </div>
          <div>
            <dt>Teams</dt>
            <dd>{view.teamCount}</dd>
          </div>
          {settlement?.collected !== undefined ? (
            <div>
              <dt>Collected</dt>
              <dd data-testid="retro-collected">{exactINR(settlement.collected)}</dd>
            </div>
          ) : null}
          {settlement?.outstanding !== undefined ? (
            <div>
              <dt>Outstanding</dt>
              <dd data-testid="retro-outstanding">{exactINR(settlement.outstanding)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="season-stepper-actions">
        {/* This card is the FINISHED season. "Review readiness" sent an
            organizer to the auction-readiness gates, where a season whose
            auction is long over reads as a wall of failures — the gates
            describe a night that already happened. The record of what
            happened is the useful destination. */}
        <Link
          href={`/seasons/${slug}/auction/replay`}
          className="season-inline-link"
          data-testid="open-replay"
        >
          Replay the auction
        </Link>
        {view.viewer.canSeeMoney ? (
          <ButtonLink href={`/seasons/${slug}/money`} variant="secondary">
            View results
          </ButtonLink>
        ) : null}
        {view.viewer.canManage ? (
          <Button
            size="touch"
            loading={busy}
            data-testid="run-it-again"
            onClick={() => void onRunItAgain()}
          >
            Run it again
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * DA-11: the season settings form. Name, dates and location were write-once —
 * three fields the lifecycle guard demands and no screen could reach.
 */
function SeasonSettingsDialog({
  open,
  slug,
  competition,
  onClose,
  onSaved,
}: {
  open: boolean;
  slug: string;
  competition: SeasonOverviewView["competition"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(competition.name);
  const [location, setLocation] = useState(competition.location ?? "");
  const [startsOn, setStartsOn] = useState(competition.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(competition.endsOn ?? "");
  const [entryCategory, setEntryCategory] = useState<string>(competition.entryCategory);
  const [error, setError] = useState<{ field: DetailsField; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const errorFor = (field: DetailsField): { error: string } | Record<string, never> =>
    error !== null && error.field === field ? { error: error.message } : {};

  const save = async () => {
    setPending(true);
    const result = await updateCompetitionDetailsAction(slug, {
      name,
      location,
      startsOn,
      endsOn,
      entryCategory,
    });
    setPending(false);
    if (result.ok) {
      setError(null);
      onSaved();
    } else {
      setError({ field: result.field ?? "form", message: result.error ?? "Could not save." });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Season details"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} data-testid="save-season-details" onClick={() => void save()}>
            Save details
          </Button>
        </>
      }
    >
      <div className="season-settings-form">
        {error !== null && error.field === "form" ? (
          <p className="season-guard" role="alert">
            {error.message}
          </p>
        ) : null}
        <Field
          label="Season name"
          name="season-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          {...errorFor("name")}
        />
        <Field
          label="Location"
          name="season-location"
          placeholder="Malad, Mumbai"
          value={location}
          onChange={(event) => {
            setLocation(event.target.value);
          }}
          {...errorFor("location")}
        />
        <div className="date-row">
          <Field
            label="Starts on"
            name="season-starts-on"
            type="date"
            value={startsOn}
            onChange={(event) => {
              setStartsOn(event.target.value);
            }}
            {...errorFor("startsOn")}
          />
          <Field
            label="Ends on"
            name="season-ends-on"
            type="date"
            value={endsOn}
            onChange={(event) => {
              setEndsOn(event.target.value);
            }}
            {...errorFor("endsOn")}
          />
        </div>
        {/* PI-1: who the season is for. Read by the register gate and the
            public terminology; enforcement lives in core's eligibility engine. */}
        <Select
          label="Entry category"
          name="season-entry-category"
          value={entryCategory}
          onChange={(event) => {
            setEntryCategory(event.target.value);
          }}
          help="Open takes everyone. A gendered category is checked at self-registration; you can still add anyone directly."
          data-testid="season-entry-category"
        >
          {ENTRY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {entryCategoryLabel(category)}
            </option>
          ))}
        </Select>
      </div>
    </Dialog>
  );
}
