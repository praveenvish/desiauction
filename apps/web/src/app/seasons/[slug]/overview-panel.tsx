"use client";

import { Badge, Button, Card, useToast } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  advanceCompetitionAction,
  cloneCompetitionAction,
  setCompetitionVisibilityAction,
  type SeasonOverviewView,
} from "../../../server/competition/actions";
import { track } from "../../../lib/telemetry";

/**
 * The Season Workspace overview (PX design "Season Workspace").
 *
 * A dashboard, not a desk: everything here READS. The work — adding teams,
 * triaging registrations, running the auction — lives in the tabs above, which
 * are full workspaces of their own. The two exceptions earn their place because
 * they are statements about the season as a whole rather than about any one
 * tab: advancing the lifecycle (hosted by the stepper, which IS the lifecycle)
 * and publishing the public page (hosted by the card footer the design gives it).
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

/** Where the season actually goes next once intake is shut (DA-10). */
function nextDestination(
  slug: string,
  auctionStatus: string | null,
): { href: string; label: string } {
  if (auctionStatus === null) {
    return { href: `/seasons/${slug}/auction`, label: "Create the auction" };
  }
  if (auctionStatus === "scheduled") {
    return { href: `/seasons/${slug}/auction`, label: "Open the auction" };
  }
  if (auctionStatus === "live" || auctionStatus === "paused") {
    return { href: `/seasons/${slug}/auction/cockpit`, label: "Enter the auction room" };
  }
  if (auctionStatus === "completed") {
    return { href: `/seasons/${slug}/money`, label: "Open settlement" };
  }
  return { href: `/seasons/${slug}/money`, label: "Review settlement" };
}

const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All rounder",
  wicket_keeper: "Wicket-keeper",
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ");
}

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

export function OverviewPanel({ view, slug }: { view: SeasonOverviewView; slug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const step = NEXT_STEP[view.competition.status] ?? null;
  const onward = nextDestination(slug, view.auctionStatus);

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
      router.refresh();
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
    if (result.ok) {
      toast({
        title: visibility === "public" ? "Public page published" : "Public page unpublished",
        tone: "success",
      });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not update.", tone: "danger" });
    }
  };

  // Which gates are behind us. DA-10: the auction and settlement ticks used to
  // read the LOTS (all sold = done), so an auction that finished with unsold
  // players — the normal case — never ticked, and settlement never could.
  // Both now follow the auction's own status, which is where that truth lives.
  const status = view.competition.status;
  const auctionDone = view.auctionStatus === "completed" || view.auctionStatus === "reconciled";
  const cleared = [
    status !== "draft",
    status === "registration_closed",
    view.teamCount > 0,
    auctionDone,
    false,
    view.auctionStatus === "reconciled",
  ];
  const activeIndex = cleared.indexOf(false);
  const STEP_LABELS = ["Setup", "Registration", "Teams", "Auction", "Fixtures", "Settlement"];

  const topSpend = view.topTeams[0]?.spend ?? 0;
  const poolMax = view.poolByRole[0]?.count ?? 0;

  return (
    <>
      <Card className="season-stepper-card" data-testid="lifecycle-panel">
        <ol className="season-stepper">
          {STEP_LABELS.map((label, index) => {
            const state = cleared[index] === true ? "done" : index === activeIndex ? "now" : "next";
            return (
              <li key={label} className="season-step" data-state={state}>
                <span className="season-step-mark" aria-hidden>
                  {state === "done" ? "✓" : String(index + 1)}
                </span>
                <span className="season-step-label">{label}</span>
              </li>
            );
          })}
        </ol>
        <div className="season-stepper-actions">
          <Link href={`/seasons/${slug}/readiness`} data-testid="open-readiness">
            Review readiness
          </Link>
          {view.viewer.canManage ? (
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              data-testid="run-it-again"
              onClick={() => void runItAgain()}
            >
              Run it again
            </Button>
          ) : null}
          {view.viewer.canManage && step !== null ? (
            <Button onClick={() => void advance()} loading={busy} data-testid="advance-status">
              {step.label}
            </Button>
          ) : view.viewer.canManage && view.competition.status === "registration_closed" ? (
            <Button
              onClick={() => {
                router.push(onward.href);
              }}
              data-testid="advance-status"
            >
              {onward.label}
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="season-tiles">
        <div className="season-tile">
          <span className="season-tile-value">{view.approvedPlayers}</span>
          <span className="season-tile-label">Approved players</span>
        </div>
        <div className="season-tile">
          <span className="season-tile-value">{view.teamCount}</span>
          <span className="season-tile-label">Teams</span>
        </div>
        <div className="season-tile">
          <span className="season-tile-value">{compactINR(view.purseCommitted)}</span>
          <span className="season-tile-label">
            Purse committed
            {view.pursePct !== null
              ? // A committed purse that rounds to nothing still isn't nothing —
                // "0%" next to a real figure reads as a bug.
                view.pursePct === 0 && view.purseCommitted > 0
                ? " · <1%"
                : ` · ${String(view.pursePct)}%`
              : ""}
          </span>
        </div>
        <div className="season-tile">
          <span className="season-tile-value season-tile-accent">
            {view.lotsSold}
            <span className="season-tile-of">/{view.lotsTotal}</span>
          </span>
          <span className="season-tile-label">Lots sold</span>
        </div>
      </div>

      <div className="season-cards">
        <Card data-testid="team-spend-card">
          <div className="season-card-head">
            <h2>Top teams by spend</h2>
            <Link href={`/seasons/${slug}/teams`}>All teams →</Link>
          </div>
          {view.topTeams.length === 0 ? (
            <p className="competitions-hint">No teams yet.</p>
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
                    {team.squadMax !== null ? (
                      <span className="season-spend-squad">
                        {team.squad}/{team.squadMax}
                      </span>
                    ) : null}
                    <span className="season-spend-amount">{exactINR(team.spend)}</span>
                  </span>
                  <span className="season-bar" aria-hidden>
                    <span
                      className="season-bar-fill"
                      style={{
                        width: `${String(topSpend > 0 ? Math.round((team.spend / topSpend) * 100) : 0)}%`,
                        ...(team.color !== null ? { background: team.color } : {}),
                      }}
                    />
                  </span>
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
            <p className="competitions-hint">No approved players yet.</p>
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
                        width: `${String(poolMax > 0 ? Math.round((entry.count / poolMax) * 100) : 0)}%`,
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="season-public-row" data-testid="visibility-row">
            <span className="season-public-label">Public page</span>
            <span className="season-public-state">
              <Badge tone={view.competition.visibility === "public" ? "success" : "neutral"}>
                {view.competition.visibility === "public" ? "LIVE" : "Not listed"}
              </Badge>
              {view.competition.visibility === "public" ? (
                <Link href={`/c/${slug}`} data-testid="open-public-page">
                  View
                </Link>
              ) : null}
              {view.viewer.canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  data-testid="toggle-visibility"
                  onClick={() =>
                    void setVisibility(
                      view.competition.visibility === "public" ? "private" : "public",
                    )
                  }
                >
                  {view.competition.visibility === "public" ? "Unpublish" : "Publish"}
                </Button>
              ) : null}
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
