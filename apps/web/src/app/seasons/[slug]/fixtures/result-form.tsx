"use client";

import { Button, Field, IconCheck, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  fixtureLifecycleAction,
  lobbyParticipantsAction,
  recordLobbyResultAction,
  recordResultAction,
  type ScheduleView,
} from "../../../../server/competition/fixture-actions";
import type { LobbyParticipantRow } from "../../../../server/competition/results";
import { TeamCrest } from "../_tabs/team-crest";
import { suggestedOutcome, type ModelResult } from "./schedule-model";
import "./result-form.css";

/**
 * THE SCORE, WHERE THE MATCH IS. Recording a result used to be a worklist card
 * on the fixtures list and finishing the match a button on Match day — two
 * screens for one moment. Here both are one form in the match's panel: type the
 * score, and "Save result and finish match" records it and completes the match
 * together. The winner is read off the score as a suggestion the scorer can
 * change (a DLS result, a super over).
 *
 * The score still arrives as the scorer typed it and is parsed on the server
 * by the season's pack — cricket's "18.3" overs included.
 */

type Fixture = ScheduleView["rows"][number];
/** What the duel form reads of a match — so the Today list can host it too. */
type DuelFixture = Pick<
  Fixture,
  | "id"
  | "status"
  | "homeTeamName"
  | "awayTeamName"
  | "homeTeamShort"
  | "awayTeamShort"
  | "homeTeamColor"
  | "awayTeamColor"
>;
type ScoreFields = ScheduleView["scoreFields"];

const OUTCOMES = (home: string, away: string) => [
  { value: "home_win", label: `${home} won` },
  { value: "away_win", label: `${away} won` },
  { value: "tie", label: "Tied" },
  // A no-result was played and shares the points; an abandoned match never
  // started and counts as nothing. Collapsing the two is the commonest way a
  // league table comes out wrong.
  { value: "no_result", label: "No result (played, not finished)" },
  { value: "abandoned", label: "Abandoned (never started)" },
];

/** What is already recorded, as the text a scorer would type back. */
function seed(
  fields: ScoreFields,
  side: Record<string, number> | undefined,
  format: (key: string, value: number) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = side?.[field.key];
    if (value !== undefined) {
      out[field.key] = format(field.key, value);
    }
  }
  return out;
}

/** Cricket stores balls; the scorer writes overs ("18.3"). Everything else is as stored. */
function asTyped(key: string, value: number): string {
  if (key === "balls") {
    return `${String(Math.floor(value / 6))}.${String(value % 6)}`;
  }
  return String(value);
}

/** The next match owed a result, to open once this one is saved (census 11). */
export interface NextOwed {
  href: string;
  label: string;
}

function useFinish(slug: string, next: NextOwed | null = null) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /**
   * Save, then (when asked) complete. The result is kept even if completing is
   * refused — it is the more valuable half — and the refusal is said.
   */
  const run = async (
    save: () => Promise<{ ok: boolean; error?: string | undefined; amended?: boolean | undefined }>,
    fixtureId: string,
    finish: boolean,
    saidAs: { recorded: string; amended: string },
  ) => {
    setBusy(true);
    const saved = await save();
    if (!saved.ok) {
      setBusy(false);
      toast({ tone: "danger", title: saved.error ?? "Refused." });
      return;
    }
    if (finish) {
      const done = await fixtureLifecycleAction(slug, fixtureId, "complete");
      setBusy(false);
      if (!done.ok) {
        toast({
          tone: "danger",
          title: `Result saved, but the match could not be finished: ${done.error ?? "refused"}`,
        });
        router.refresh();
        return;
      }
      // THE RESULTS DESK MOVES ON: with results owed, the next one opens,
      // so three owed matches are three saves, not three trips back to the
      // list (census 11).
      if (next !== null) {
        toast({ tone: "success", title: `${saidAs.recorded} · next: ${next.label}` });
        router.push(next.href, { scroll: false });
        return;
      }
      toast({ tone: "success", title: `${saidAs.recorded} · match finished` });
    } else {
      setBusy(false);
      toast({ tone: "success", title: saved.amended === true ? saidAs.amended : saidAs.recorded });
    }
    router.refresh();
  };
  return { run, busy };
}

export function DuelResultForm({
  slug,
  fixture,
  result,
  scoreFields,
  next = null,
  overdue = false,
}: {
  slug: string;
  fixture: DuelFixture;
  result: ModelResult | undefined;
  scoreFields: ScoreFields;
  /** Opened after "save and finish" when more results are owed. */
  next?: NextOwed | null;
  /**
   * A match whose day has passed (the Today list's "Result due"). It is over,
   * so the one step is "save and finish" — and a match never started on the
   * app is started first, rather than sending the organizer to press Start on
   * a game played yesterday.
   */
  overdue?: boolean;
}) {
  const homeName = fixture.homeTeamName ?? "Home";
  const awayName = fixture.awayTeamName ?? "Away";
  const [home, setHome] = useState<Record<string, string>>(() =>
    seed(scoreFields, result?.score?.home, asTyped),
  );
  const [away, setAway] = useState<Record<string, string>>(() =>
    seed(scoreFields, result?.score?.away, asTyped),
  );
  const [outcome, setOutcome] = useState(result?.outcome ?? "");
  // Once the scorer picks the outcome themselves, the score stops suggesting it.
  const [outcomeTouched, setOutcomeTouched] = useState(result !== undefined);
  const [method, setMethod] = useState("");
  const { run, busy } = useFinish(slug, next);
  const primary = scoreFields[0]?.key ?? "";
  const live = fixture.status === "in_progress";
  const startFirst = overdue && fixture.status === "published";

  // Until the scorer picks it, the outcome is whatever the score says.
  const shown = outcomeTouched
    ? outcome
    : (suggestedOutcome(home[primary] ?? "", away[primary] ?? "") ?? outcome);

  const save = (finish: boolean) =>
    run(
      async () => {
        if (startFirst) {
          const started = await fixtureLifecycleAction(slug, fixture.id, "start");
          if (!started.ok) return started;
        }
        return recordResultAction(slug, fixture.id, {
          outcome: shown,
          home,
          away,
          method,
        });
      },
      fixture.id,
      finish,
      { recorded: "Result recorded", amended: "Result amended" },
    );

  const side = (which: "home" | "away") => {
    const values = which === "home" ? home : away;
    const set = which === "home" ? setHome : setAway;
    const name = which === "home" ? homeName : awayName;
    return (
      <fieldset className="mx-score-side">
        <legend className="mx-score-team">
          <TeamCrest
            name={name}
            short={which === "home" ? fixture.homeTeamShort : fixture.awayTeamShort}
            color={which === "home" ? fixture.homeTeamColor : fixture.awayTeamColor}
          />
          <span>{name}</span>
        </legend>
        <div className="mx-score-fields">
          {scoreFields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              aria-label={`${name} ${field.label.toLowerCase()}`}
              name={`${which}-${field.key}`}
              inputMode={field.key === "balls" ? "decimal" : "numeric"}
              value={values[field.key] ?? ""}
              onChange={(event) => {
                set({ ...values, [field.key]: event.target.value });
              }}
              data-testid={`result-${which}-${field.key}`}
            />
          ))}
        </div>
      </fieldset>
    );
  };

  return (
    <div className="mx-result" data-testid="result-form">
      {side("home")}
      {side("away")}
      <Select
        label="Result"
        value={shown}
        onChange={(event) => {
          setOutcome(event.target.value);
          setOutcomeTouched(true);
        }}
        data-testid="result-outcome"
      >
        <option value="" disabled>
          Enter both scores, or choose
        </option>
        {OUTCOMES(homeName, awayName).map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </Select>
      {scoreFields.some((field) => field.help !== undefined) ? (
        <p className="st-note">
          {scoreFields
            .filter((field) => field.help !== undefined)
            .map((field) => field.help)
            .join(" ")}
        </p>
      ) : null}
      <details className="mx-more">
        <summary>Decided another way? (DLS, super over, conceded)</summary>
        <Field
          label="Method"
          name="method"
          value={method}
          onChange={(event) => {
            setMethod(event.target.value);
          }}
        />
      </details>
      <div className="mx-result-go">
        {live || overdue ? (
          <>
            <Button
              size="touch"
              loading={busy}
              disabled={shown === ""}
              onClick={() => void save(true)}
              data-testid="result-finish"
            >
              <IconCheck size={18} aria-hidden />
              Save result and finish match
            </Button>
            {overdue ? null : (
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                disabled={shown === ""}
                onClick={() => void save(false)}
                data-testid="result-submit"
              >
                Save score, still playing
              </Button>
            )}
          </>
        ) : (
          <Button
            size="touch"
            loading={busy}
            disabled={shown === ""}
            onClick={() => void save(false)}
            data-testid="result-submit"
          >
            {result === undefined ? "Save result" : "Update result"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A LOBBY is scored by where each squad finished — 1 is the win, and squads may
 * share a place. Its squads are fetched when the panel opens: a season of
 * lobbies is a season of squad lists, and only one is ever on screen.
 */
export function LobbyResultForm({
  slug,
  fixture,
  scoreFields,
  next = null,
}: {
  slug: string;
  fixture: Fixture;
  scoreFields: ScoreFields;
  next?: NextOwed | null;
}) {
  const [squads, setSquads] = useState<readonly LobbyParticipantRow[] | null>(null);
  const [places, setPlaces] = useState<
    Record<string, { placement: string; score: Record<string, string> }>
  >({});
  const { run, busy } = useFinish(slug, next);
  const live = fixture.status === "in_progress";

  useEffect(() => {
    let cancelled = false;
    void lobbyParticipantsAction(slug, fixture.id).then((rows) => {
      if (cancelled) return;
      setSquads(rows);
      // Seeded from what is recorded, so amending starts from the placings it
      // has rather than silently dropping every squad not retyped.
      const seeded: Record<string, { placement: string; score: Record<string, string> }> = {};
      for (const row of rows) {
        seeded[row.teamId] = {
          placement: row.placement === null ? "" : String(row.placement),
          score: seed(scoreFields, row.score ?? undefined, (_key, value) => String(value)),
        };
      }
      setPlaces(seeded);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, fixture.id, scoreFields]);

  const setPlace = (
    teamId: string,
    patch: { placement?: string; scoreKey?: string; value?: string },
  ) => {
    setPlaces((prev) => {
      const current = prev[teamId] ?? { placement: "", score: {} };
      const next =
        patch.placement !== undefined
          ? { ...current, placement: patch.placement }
          : { ...current, score: { ...current.score, [patch.scoreKey ?? ""]: patch.value ?? "" } };
      return { ...prev, [teamId]: next };
    });
  };

  const save = (finish: boolean) =>
    run(
      () =>
        recordLobbyResultAction(
          slug,
          fixture.id,
          (squads ?? []).map((row) => ({
            teamId: row.teamId,
            placement: places[row.teamId]?.placement ?? "",
            score: places[row.teamId]?.score ?? {},
          })),
        ),
      fixture.id,
      finish,
      { recorded: "Lobby recorded", amended: "Lobby amended" },
    );

  if (squads === null) {
    return <p className="st-note">Loading the squads…</p>;
  }
  if (squads.length === 0) {
    return <p className="st-note">This lobby has no squads in it.</p>;
  }
  return (
    <div className="mx-result" data-testid="lobby-form">
      <p className="st-note">1 is the win; squads may share a place.</p>
      {squads.map((squad) => (
        <div key={squad.teamId} className="fx-squad-row" data-testid={`squad-row-${squad.teamId}`}>
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
                setPlace(squad.teamId, { scoreKey: field.key, value: event.target.value });
              }}
              data-testid={`lobby-${squad.teamId}-${field.key}`}
            />
          ))}
        </div>
      ))}
      <div className="mx-result-go">
        {live ? (
          <>
            <Button
              size="touch"
              loading={busy}
              onClick={() => void save(true)}
              data-testid="lobby-finish"
            >
              <IconCheck size={18} aria-hidden />
              Save placings and finish
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              onClick={() => void save(false)}
              data-testid="lobby-submit"
            >
              Save placings, still playing
            </Button>
          </>
        ) : (
          <Button
            size="touch"
            loading={busy}
            onClick={() => void save(false)}
            data-testid="lobby-submit"
          >
            Save placings
          </Button>
        )}
      </div>
    </div>
  );
}
