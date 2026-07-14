"use client";

import { Badge, Button, Card, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

  const run = async (fixtureId: string, action: FixtureLifecycleAction) => {
    setBusy(true);
    const result = await fixtureLifecycleAction(slug, fixtureId, action);
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      toast({ title: result.error ?? "That didn't work.", tone: "danger" });
    }
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
                    {fixture.kickoffAt !== null ? fixture.kickoffAt.slice(11) : "—"}
                  </span>
                  <Badge tone={FIXTURE_TONE[fixture.status]}>
                    {fixture.status.replace(/_/g, " ")}
                  </Badge>
                  {canManage && next !== undefined ? (
                    <Button
                      size="sm"
                      onClick={() => void run(fixture.id, next.action)}
                      loading={busy}
                      data-testid={`${next.action}-${fixture.number}`}
                    >
                      {next.label}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </>
  );
}
