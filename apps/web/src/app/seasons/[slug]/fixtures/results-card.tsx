"use client";

import { Badge, Button, Card, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  lobbyParticipantsAction,
  recordLobbyResultAction,
  recordResultAction,
} from "../../../../server/competition/fixture-actions";
import type { LobbyParticipantRow } from "../../../../server/competition/results";

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
  /** Null on a LOBBY — one match, many squads, no home and no away. */
  readonly homeTeamId: string | null;
  readonly homeTeamName: string | null;
  readonly awayTeamName: string | null;
  readonly status: string;
  /** Lobby only: how many squads dropped in, and how many have been placed. */
  readonly squadCount: number;
  readonly placedCount: number;
}

const isLobbyFixture = (fixture: ResultFixture): boolean => fixture.homeTeamId === null;

/**
 * Whether this fixture has a result at all.
 *
 * A duel's answer is in `fixture_results`. A LOBBY writes no row there — its
 * result lives on the participants, as placements — so the only honest test is
 * whether every squad in it has been placed. Reading the results map for a
 * lobby would mark every one of them outstanding forever.
 */
function isScored(fixture: ResultFixture, results: Record<string, unknown>): boolean {
  if (isLobbyFixture(fixture)) {
    return fixture.squadCount > 0 && fixture.placedCount === fixture.squadCount;
  }
  return results[fixture.id] !== undefined;
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
  /*
   * The squads of the lobby currently open, and what the scorer has typed for
   * each. Fetched when a lobby is opened rather than carried on the dashboard:
   * a season of lobbies is a season of squad lists, and only one is ever on
   * screen. `null` is "still loading", an empty array is "there are none".
   */
  const [squads, setSquads] = useState<readonly LobbyParticipantRow[] | null>(null);
  const [places, setPlaces] = useState<
    Record<string, { placement: string; score: Record<string, string> }>
  >({});

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
  const outstanding = played.filter((fixture) => !isScored(fixture, results));
  if (played.length === 0) {
    return null;
  }

  /**
   * Open a row — and for a lobby, go and get its squads.
   *
   * The typed values are seeded from what is already recorded, so amending a
   * lobby starts from the placements it has rather than from an empty form
   * that would silently drop every squad the scorer did not retype.
   */
  const open = (fixture: ResultFixture) => {
    if (openId === fixture.id) {
      setOpenId(null);
      return;
    }
    setOpenId(fixture.id);
    if (!isLobbyFixture(fixture)) {
      return;
    }
    setSquads(null);
    setPlaces({});
    void lobbyParticipantsAction(slug, fixture.id).then((rows) => {
      setSquads(rows);
      const seeded: Record<string, { placement: string; score: Record<string, string> }> = {};
      for (const row of rows) {
        const score: Record<string, string> = {};
        for (const field of scoreFields) {
          const value = row.score?.[field.key];
          if (value !== undefined) {
            score[field.key] = String(value);
          }
        }
        seeded[row.teamId] = {
          placement: row.placement === null ? "" : String(row.placement),
          score,
        };
      }
      setPlaces(seeded);
    });
  };

  const setPlace = (
    teamId: string,
    patch: { placement?: string; scoreKey?: string; value?: string },
  ) => {
    setPlaces((prev) => {
      const current = prev[teamId] ?? { placement: "", score: {} };
      const next =
        patch.placement !== undefined
          ? { ...current, placement: patch.placement }
          : {
              ...current,
              score: { ...current.score, [patch.scoreKey ?? ""]: patch.value ?? "" },
            };
      return { ...prev, [teamId]: next };
    });
  };

  const submitLobby = (fixtureId: string) => {
    setBusy(true);
    const payload = (squads ?? []).map((row) => ({
      teamId: row.teamId,
      placement: places[row.teamId]?.placement ?? "",
      score: places[row.teamId]?.score ?? {},
    }));
    void recordLobbyResultAction(slug, fixtureId, payload).then((result) => {
      setBusy(false);
      if (result.ok) {
        toast({
          tone: "success",
          title: result.amended === true ? "Lobby amended" : "Lobby recorded",
        });
        setOpenId(null);
        router.refresh();
      } else {
        toast({ tone: "danger", title: result.error ?? "Refused." });
      }
    });
  };

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
        {played.some(isLobbyFixture)
          ? "A lobby is scored by where each squad finished — 1 is the win, and squads may share a place. The table is derived from these, so a correction here moves it immediately."
          : "Overs are written the way a scorer writes them — 18.3 is eighteen overs and three balls. The table is derived from these, so a correction here moves it immediately."}
      </p>
      <ul className="cockpit-queue" data-testid="results-list">
        {/* Outstanding first: this list is a worklist, and the matches that
            still need something are the reason anybody opened it. */}
        {[...outstanding, ...played.filter((f) => isScored(f, results))].map((fixture) => {
          const recorded = results[fixture.id];
          const lobby = isLobbyFixture(fixture);
          const scored = isScored(fixture, results);
          return (
            <li key={fixture.id} data-testid={`result-${fixture.number}`}>
              <Badge tone={scored ? "neutral" : "warning"}>{fixture.number}</Badge>
              <span className="registration-name">
                {lobby
                  ? `${String(fixture.squadCount)} squads`
                  : `${fixture.homeTeamName ?? "TBA"} v ${fixture.awayTeamName ?? "TBA"}`}
              </span>
              <span className="competitions-hint">
                {lobby
                  ? scored
                    ? "every squad placed"
                    : `${String(fixture.placedCount)} of ${String(fixture.squadCount)} placed`
                  : recorded === undefined
                    ? "no result recorded"
                    : `${summarise(recorded.score?.home)} – ${summarise(recorded.score?.away)} · ${recorded.outcome.replace("_", " ")}`}
              </span>
              {canManage ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    open(fixture);
                  }}
                  data-testid={`record-${fixture.number}`}
                >
                  {scored ? "Amend" : "Record"}
                </Button>
              ) : null}
              {canManage && openId === fixture.id && lobby ? (
                <div className="authority-form" data-testid="lobby-form">
                  {squads === null ? (
                    <p className="competitions-hint">Loading the squads…</p>
                  ) : squads.length === 0 ? (
                    <p className="competitions-hint">This lobby has no squads in it.</p>
                  ) : (
                    <>
                      {/* One block per squad, in finishing order. Placement is a
                          number the scorer reads off the end screen — 1 is the
                          win, and two squads may genuinely share a place. */}
                      {squads.map((squad) => (
                        <div
                          key={squad.teamId}
                          className="date-row"
                          data-testid={`squad-row-${squad.teamId}`}
                        >
                          <Field
                            label={`${squad.teamName} placement`}
                            name={`placement-${squad.teamId}`}
                            inputMode="numeric"
                            value={places[squad.teamId]?.placement ?? ""}
                            onChange={(event) => {
                              setPlace(squad.teamId, { placement: event.target.value });
                            }}
                            data-testid={`placement-${squad.teamId}`}
                          />
                          {scoreFields.map((field) => (
                            <Field
                              key={field.key}
                              label={`${squad.teamName} ${field.label.toLowerCase()}`}
                              name={`${squad.teamId}-${field.key}`}
                              inputMode="numeric"
                              {...(field.help !== undefined ? { help: field.help } : {})}
                              value={places[squad.teamId]?.score[field.key] ?? ""}
                              onChange={(event) => {
                                setPlace(squad.teamId, {
                                  scoreKey: field.key,
                                  value: event.target.value,
                                });
                              }}
                              data-testid={`lobby-${squad.teamId}-${field.key}`}
                            />
                          ))}
                        </div>
                      ))}
                      <Button
                        size="touch"
                        loading={busy}
                        onClick={() => {
                          submitLobby(fixture.id);
                        }}
                        data-testid="lobby-submit"
                      >
                        Save placements
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
              {canManage && openId === fixture.id && !lobby ? (
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
