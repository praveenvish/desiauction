"use client";

import { Badge, Button, Card, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { recordResultAction } from "../../../../server/competition/fixture-actions";

/**
 * RESULTS — a worklist, not a form buried on a detail page.
 *
 * The question an organizer actually has on a Monday morning is "which of
 * Saturday's matches still need a score", and until now the product could not
 * answer it at all: a fixture could be scheduled, published, started and marked
 * `completed` while nothing recorded who won.
 *
 * So the completed fixtures WITHOUT a result are listed first and named as
 * outstanding. A season quietly accumulates these, and nothing else surfaces
 * them — a table that says "6 of 20 results in" is the symptom; this is where
 * it gets fixed.
 */

export interface ResultFixture {
  readonly id: string;
  readonly number: string;
  readonly homeTeamName: string | null;
  readonly awayTeamName: string | null;
  readonly status: string;
}

const OUTCOMES: readonly { value: string; label: string }[] = [
  { value: "home_win", label: "Home won" },
  { value: "away_win", label: "Away won" },
  { value: "tie", label: "Tied" },
  // Named as leagues mean them. A no-result was played and shares the points; an
  // abandoned match never started and counts as nothing. Collapsing the two is
  // the commonest way a league table comes out wrong.
  { value: "no_result", label: "No result (played, not finished)" },
  { value: "abandoned", label: "Abandoned (never started)" },
];

export function ResultsCard({
  slug,
  fixtures,
  results,
  canManage,
}: {
  slug: string;
  fixtures: readonly ResultFixture[];
  results: Record<string, { outcome: string; homeRuns: number | null; awayRuns: number | null }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    outcome: "home_win",
    homeRuns: "",
    homeWickets: "",
    homeOvers: "",
    awayRuns: "",
    awayWickets: "",
    awayOvers: "",
    method: "",
  });

  const played = fixtures.filter(
    (fixture) => fixture.status === "completed" || fixture.status === "in_progress",
  );
  const outstanding = played.filter((fixture) => results[fixture.id] === undefined);
  if (played.length === 0) {
    return null;
  }

  const submit = (fixtureId: string) => {
    setBusy(true);
    void recordResultAction(slug, fixtureId, form).then((result) => {
      setBusy(false);
      if (result.ok) {
        toast({
          tone: "success",
          title: result.amended === true ? "Result amended" : "Result recorded",
        });
        setOpenId(null);
        router.refresh();
      } else {
        // The server's own sentence. Its refusals name the actual problem —
        // overs written as .6, a winner with no score — and a generic
        // "could not save" would send a scorer hunting through six fields.
        toast({ tone: "danger", title: result.error ?? "Refused." });
      }
    });
  };

  return (
    <Card data-testid="results-card">
      <div className="competition-title-row">
        <h2>Results</h2>
        <Badge
          tone={outstanding.length === 0 ? "success" : "warning"}
          data-testid="results-outstanding"
        >
          {outstanding.length === 0
            ? "All played matches scored"
            : `${String(outstanding.length)} still to score`}
        </Badge>
      </div>
      <p className="competitions-hint">
        Overs are written the way a scorer writes them — 18.3 is eighteen overs and three balls. The
        table is derived from these, so a correction here moves it immediately.
      </p>
      <ul className="cockpit-queue" data-testid="results-list">
        {/* Outstanding first: this list is a worklist, and the matches that
            still need something are the reason anybody opened it. */}
        {[...outstanding, ...played.filter((f) => results[f.id] !== undefined)].map((fixture) => {
          const recorded = results[fixture.id];
          return (
            <li key={fixture.id} data-testid={`result-${fixture.number}`}>
              <Badge tone={recorded === undefined ? "warning" : "neutral"}>{fixture.number}</Badge>
              <span className="registration-name">
                {fixture.homeTeamName ?? "TBA"} v {fixture.awayTeamName ?? "TBA"}
              </span>
              <span className="competitions-hint">
                {recorded === undefined
                  ? "no result recorded"
                  : `${String(recorded.homeRuns ?? "—")} – ${String(recorded.awayRuns ?? "—")} · ${recorded.outcome.replace("_", " ")}`}
              </span>
              {canManage ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setOpenId(openId === fixture.id ? null : fixture.id);
                  }}
                  data-testid={`record-${fixture.number}`}
                >
                  {recorded === undefined ? "Record" : "Amend"}
                </Button>
              ) : null}
              {canManage && openId === fixture.id ? (
                <div className="authority-form" data-testid="result-form">
                  <Select
                    label="How it ended"
                    value={form.outcome}
                    onChange={(event) => {
                      setForm({ ...form, outcome: event.target.value });
                    }}
                    data-testid="result-outcome"
                  >
                    {OUTCOMES.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                  <Field
                    label={`${fixture.homeTeamName ?? "Home"} runs`}
                    name="homeRuns"
                    inputMode="numeric"
                    value={form.homeRuns}
                    onChange={(event) => {
                      setForm({ ...form, homeRuns: event.target.value });
                    }}
                    data-testid="result-home-runs"
                  />
                  <Field
                    label="Home wickets"
                    name="homeWickets"
                    inputMode="numeric"
                    value={form.homeWickets}
                    onChange={(event) => {
                      setForm({ ...form, homeWickets: event.target.value });
                    }}
                  />
                  <Field
                    label="Home overs"
                    name="homeOvers"
                    help="18.3 — not 18.5 for a half"
                    value={form.homeOvers}
                    onChange={(event) => {
                      setForm({ ...form, homeOvers: event.target.value });
                    }}
                    data-testid="result-home-overs"
                  />
                  <Field
                    label={`${fixture.awayTeamName ?? "Away"} runs`}
                    name="awayRuns"
                    inputMode="numeric"
                    value={form.awayRuns}
                    onChange={(event) => {
                      setForm({ ...form, awayRuns: event.target.value });
                    }}
                    data-testid="result-away-runs"
                  />
                  <Field
                    label="Away wickets"
                    name="awayWickets"
                    inputMode="numeric"
                    value={form.awayWickets}
                    onChange={(event) => {
                      setForm({ ...form, awayWickets: event.target.value });
                    }}
                  />
                  <Field
                    label="Away overs"
                    name="awayOvers"
                    value={form.awayOvers}
                    onChange={(event) => {
                      setForm({ ...form, awayOvers: event.target.value });
                    }}
                    data-testid="result-away-overs"
                  />
                  <Field
                    label="Method"
                    name="method"
                    help="DLS, super over, conceded — when it was not simply the higher score."
                    value={form.method}
                    onChange={(event) => {
                      setForm({ ...form, method: event.target.value });
                    }}
                  />
                  <Button
                    size="touch"
                    loading={busy}
                    onClick={() => {
                      submit(fixture.id);
                    }}
                    data-testid="result-submit"
                  >
                    Save result
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
