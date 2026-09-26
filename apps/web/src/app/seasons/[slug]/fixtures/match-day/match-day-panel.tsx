"use client";

import {
  Button,
  Dialog,
  IconInfo,
  IconPin,
  Notice,
  SectionCard,
  TeamChip,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { formatWallTime } from "../../../../../lib/format-date";
import {
  fixtureLifecycleAction,
  type FixtureLifecycleAction,
  type MatchDayView,
} from "../../../../../server/competition/fixture-actions";
import { FixtureStatusPill } from "../../_tabs/fixture-status";

// Match-day operations (M-IP3-3): one date, grouped by ground, with the single
// legal next lifecycle step per fixture. No live match management — the machine
// edges (start, complete, cancel) only.

const NEXT_ACTION: Partial<Record<string, { action: FixtureLifecycleAction; label: string }>> = {
  published: { action: "start", label: "Start match" },
  in_progress: { action: "complete", label: "Complete" },
};

type MatchDayFixture = MatchDayView["groundGroups"][number]["fixtures"][number];

/** Cancellable right up to the moment it is played — a ground can be rained off. */
function cancellable(status: string): boolean {
  return status !== "completed" && status !== "cancelled";
}

export function MatchDayPanel({
  slug,
  groundGroups,
  canManage,
  empty,
}: {
  slug: string;
  groundGroups: MatchDayView["groundGroups"];
  canManage: boolean;
  /** What an empty day shows (the page draws the week around it). */
  empty?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Complete is TERMINAL and immutable (packages/core/src/fixture.ts: the
  // `completed` state has no exits at all) and it used to fire on one click of a
  // button sitting between "Start match" and the next fixture. Cancel is the
  // same shape. Both now confirm, in a real dialog — the shape screen 15 landed.
  const [confirming, setConfirming] = useState<{
    fixture: MatchDayFixture;
    action: FixtureLifecycleAction;
  } | null>(null);

  const run = async (fixtureId: string, action: FixtureLifecycleAction) => {
    setBusy(true);
    const result = await fixtureLifecycleAction(slug, fixtureId, action);
    setBusy(false);
    setConfirming(null);
    if (result.ok) {
      router.refresh();
    } else {
      toast({ title: result.error ?? "That didn't work.", tone: "danger" });
    }
  };

  const start = (fixture: MatchDayFixture, action: FixtureLifecycleAction) => {
    if (action === "start") {
      void run(fixture.id, action); // reversible: a started match can be cancelled
      return;
    }
    setConfirming({ fixture, action });
  };

  if (groundGroups.length === 0) {
    if (empty !== undefined) {
      return <>{empty}</>;
    }
    return (
      <SectionCard
        icon={<IconPin />}
        tone="neutral"
        title="No fixtures on this date"
        description="Step to another day, or open the calendar to find the next match."
        data-testid="match-day-empty"
      />
    );
  }

  return (
    <>
      {/* This screen groups by ground, prints kickoff times and offers
          Start/Complete — the exact affordances of a live match console. It is
          not one, and saying so once is cheaper than letting an organizer find
          out at the ground. */}
      <Notice tone="info" icon={<IconInfo size={18} />} testId="match-day-scope">
        Complete marks the match as played. Record the score afterwards on the Fixtures tab&apos;s
        Results card.
      </Notice>
      {groundGroups.map((group) => (
        <SectionCard
          key={group.groundId ?? "unassigned"}
          icon={<IconPin />}
          concept="venue"
          title={group.groundName}
          description={`${group.venueName} · ${String(group.fixtures.length)} match${group.fixtures.length === 1 ? "" : "es"}`}
          flush
          data-testid={`ground-group-${group.groundName}`}
        >
          <ul className="cal-lines">
            {group.fixtures.map((fixture) => {
              const next = NEXT_ACTION[fixture.status];
              return (
                <li
                  className="cal-line md-line"
                  key={fixture.id}
                  data-testid={`md-${fixture.number}`}
                >
                  <span className="cal-line-time">
                    <strong>
                      {fixture.kickoffAt !== null ? formatWallTime(fixture.kickoffAt) : "—"}
                    </strong>
                    <span className="st-mono">{fixture.number}</span>
                  </span>
                  <span className="cal-line-main">
                    <span className="fx-teams">
                      {fixture.homeTeamId === null ? (
                        <TeamChip color={null}>{fixture.squadCount} squads</TeamChip>
                      ) : (
                        <>
                          <TeamChip color={fixture.homeTeamColor}>{fixture.homeTeamName}</TeamChip>
                          <span className="fx-vs">vs</span>
                          <TeamChip color={fixture.awayTeamColor}>{fixture.awayTeamName}</TeamChip>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="md-side">
                    <FixtureStatusPill status={fixture.status} />
                    {canManage && next !== undefined ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          start(fixture, next.action);
                        }}
                        loading={busy}
                        data-testid={`${next.action}-${fixture.number}`}
                      >
                        {next.label}
                      </Button>
                    ) : null}
                    {/* An organizer standing at a rained-off ground had no way to
                        call a match off from here at all. */}
                    {canManage && cancellable(fixture.status) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setConfirming({ fixture, action: "cancel" });
                        }}
                        data-testid={`cancel-${fixture.number}`}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ))}

      <Dialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null);
        }}
        title={confirming?.action === "cancel" ? "Call this match off?" : "Mark this match played?"}
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setConfirming(null);
            }}
          >
            Go back
          </Button>
        }
      >
        {confirming !== null ? (
          <div data-testid="match-day-confirm" className="fx-dialog-body">
            <p>
              <strong>{confirming.fixture.number}</strong> — {confirming.fixture.homeTeamName} vs{" "}
              {confirming.fixture.awayTeamName}
              {confirming.fixture.kickoffAt !== null
                ? `, ${formatWallTime(confirming.fixture.kickoffAt)}`
                : ""}
              .
            </p>
            <p>
              {confirming.action === "cancel"
                ? "Cancelling releases the ground and the slot. A cancelled fixture cannot be brought back — you would schedule a new one."
                : "Completing is final: a completed fixture cannot be reopened. No score is recorded."}
            </p>
            <Button
              onClick={() => void run(confirming.fixture.id, confirming.action)}
              loading={busy}
              data-testid="match-day-confirm-btn"
            >
              {confirming.action === "cancel" ? "Cancel the match" : "Mark it played"}
            </Button>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
