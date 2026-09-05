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

/**
 * The scoreline in one line. The PRIMARY component only — runs, or goals — the
 * way a result reads when somebody asks who won. An em dash for a component
 * that was never recorded, because zero is a real score.
 */
function summarise(side: Record<string, number> | undefined): string {
  const first = side === undefined ? undefined : Object.values(side)[0];
  return first === undefined ? "—" : String(first);
}

export function ResultsCard({
  slug,
  fixtures,
  results,
  scoreFields,
  canManage,
}: {
  slug: string;
  fixtures: readonly ResultFixture[];
  results: Record<
    string,
    {
      outcome: string;
      score: { home?: Record<string, number>; away?: Record<string, number> } | null;
    }
  >;
  /**
   * The season's score components, as plain data. The pack itself cannot cross
   * this boundary — it carries functions — so the form receives the labels and
   * the server parses what the scorer types (SP-1 Phase 2).
   */
  scoreFields: readonly { key: string; label: string; help?: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{
    outcome: string;
    home: Record<string, string>;
    away: Record<string, string>;
    method: string;
  }>({ outcome: "home_win", home: {}, away: {}, method: "" });

  /** One numeric input per score component, per side. */
  const scoreInputs = (side: "home" | "away", teamName: string | null) =>
    scoreFields.map((field) => (
      <Field
        key={`${side}-${field.key}`}
        label={`${side === "home" ? (teamName ?? "Home") : (teamName ?? "Away")} ${(field.help !==
        undefined
          ? field.label
          : field.label
        ).toLowerCase()}`}
        name={`${side}-${field.key}`}
        inputMode="numeric"
        {...(field.help !== undefined ? { help: field.help } : {})}
        value={form[side][field.key] ?? ""}
        onChange={(event) => {
          setForm({ ...form, [side]: { ...form[side], [field.key]: event.target.value } });
        }}
        data-testid={`result-${side}-${field.key}`}
      />
    ));

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
                  : `${summarise(recorded.score?.home)} – ${summarise(recorded.score?.away)} · ${recorded.outcome.replace("_", " ")}`}
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
                  {scoreInputs("home", fixture.homeTeamName)}
                  {scoreInputs("away", fixture.awayTeamName)}
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
