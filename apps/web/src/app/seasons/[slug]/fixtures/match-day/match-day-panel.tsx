"use client";

import { Badge, Button, Card, Dialog, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatWallTime } from "../../../../../lib/format-date";
import {
  fixtureLifecycleAction,
  type FixtureLifecycleAction,
  type MatchDayView,
} from "../../../../../server/competition/fixture-actions";

// Match-day operations (M-IP3-3): one date, grouped by ground, with the single
// legal next lifecycle step per fixture. No live match management — the machine
// edges (start, complete, cancel) only.

const FIXTURE_TONE = {
  draft: "neutral",
  scheduled: "info",
  published: "success",
  in_progress: "warning",
  completed: "neutral",
  cancelled: "danger",
} as const;

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
}: {
  slug: string;
  groundGroups: MatchDayView["groundGroups"];
  canManage: boolean;
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
    return (
      <Card>
        <p className="competitions-hint" data-testid="match-day-empty">
          No fixtures on this date.
        </p>
      </Card>
    );
  }

  return (
    <>
      {/* This screen groups by ground, prints kickoff times and offers
          Start/Complete — the exact affordances of a live match console. It is
          not one, and saying so once is cheaper than letting an organizer find
          out at the ground. */}
      <Card>
        <p className="competitions-hint" data-testid="match-day-scope">
          Results and scoring aren&apos;t part of DesiAuction yet — Complete just marks the match as
          played.
        </p>
      </Card>
      {groundGroups.map((group) => (
        <Card key={group.groundId ?? "unassigned"} data-testid={`ground-group-${group.groundName}`}>
          <div className="competition-head">
            <h2>{group.groundName}</h2>
            <span className="competitions-hint">{group.venueName}</span>
          </div>
          <ul className="calendar-day-list">
            {group.fixtures.map((fixture) => {
              const next = NEXT_ACTION[fixture.status];
              return (
                <li
                  className="calendar-fixture"
                  key={fixture.id}
                  data-testid={`md-${fixture.number}`}
                >
                  <span className="reg-number">{fixture.number}</span>
                  <span className="registration-name">
                    {fixture.homeTeamName} vs {fixture.awayTeamName}
                  </span>
                  <span className="registration-phone">
                    {fixture.kickoffAt !== null ? formatWallTime(fixture.kickoffAt) : "—"}
                  </span>
                  <Badge tone={FIXTURE_TONE[fixture.status]}>
                    {fixture.status.replace(/_/g, " ")}
                  </Badge>
                  {canManage && next !== undefined ? (
                    <Button
                      size="sm"
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
                </li>
              );
            })}
          </ul>
        </Card>
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
          <div data-testid="match-day-confirm">
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
                : "Completing is final: a completed fixture is immutable and has no way back. No score is recorded."}
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
