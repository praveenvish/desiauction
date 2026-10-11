"use client";
import { loadScoringStorage } from "../../lib/scoring-storage-loader";
import { initialsOf } from "@desiauction/core";
import { conditionsLine } from "@desiauction/core/scoring";
import { Button, ButtonLink, TeamShield } from "@desiauction/ui";
import { useEffect, useState } from "react";
import type { FamilyScoringSetup } from "../../server/scoring/home";

import { onScoringStop } from "./storage-events";
import type { PreparationOutcome } from "./[fixtureId]/prepare";
const QUICK_MATCH_AVAILABLE = { enabled: true };
export function HomeCards({ matches }: { matches: FamilyScoringSetup[] }) {
  const [signedOut, setSignedOut] = useState(false);
  const [outcomes, setOutcomes] = useState<PreparationOutcome[]>([]);
  const [preparing, setPreparing] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      onScoringStop(() => {
        setSignedOut(true);
        setOutcomes([]);
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    if ("caches" in window)
      void caches
        .match("/score/shell")
        .then((response) => {
          if (response)
            return loadScoringStorage()
              .then(({ readPreparedMatch }) =>
                Promise.all(matches.map((match) => readPreparedMatch(match.fixtureId))),
              )
              .then((prepared) => {
                if (active)
                  setOutcomes(
                    prepared.flatMap((match, index): PreparationOutcome[] =>
                      match
                        ? [
                            {
                              fixtureId: matches[index]?.fixtureId ?? "",
                              status: match.preparation === "started" ? "ready" : "unstarted",
                            },
                          ]
                        : [],
                    ),
                  );
              });
        })
        .catch(() => {
          /* Storage may be unavailable on this browser. */
        });
    return () => {
      active = false;
    };
  }, [matches]);
  async function runPreparation(ids: string[]) {
    setPreparing(true);
    setError(null);
    try {
      const { prepareMatchDay } = await loadScoringStorage();
      const updated = await prepareMatchDay(ids);
      setOutcomes((previous) => [
        ...previous.filter((outcome) => !ids.includes(outcome.fixtureId)),
        ...updated,
      ]);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Preparation could not finish. Try again.",
      );
    } finally {
      setPreparing(false);
    }
  }
  if (signedOut) return <p role="status">Signed out. Sign in again to open your matches.</p>;
  return (
    <div className="score-home-cards">
      {matches.length > 0 && (
        <Button
          disabled={preparing}
          variant="secondary"
          onClick={() => {
            void runPreparation(matches.map((match) => match.fixtureId));
          }}
        >
          {preparing ? "Preparing matches…" : "Get ready for match day"}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {matches.length === 0 && (
        <p className="score-empty">
          No matches to score today. Your appointed matches appear here when they are published.
        </p>
      )}
      {matches.map((match, index) => {
        const outcome = outcomes.find((result) => result.fixtureId === match.fixtureId);
        const offlineReady = outcome?.status === "ready";
        const started = Boolean(match.phase && match.phase !== "not_started");
        const ready = match.teams.every((t) => t.selectedIds.length >= 2);
        const missing = match.teams.find((t) => t.selectedIds.length < 2);
        const href =
          match.phase && match.phase !== "not_started"
            ? `/score/${match.fixtureId}`
            : `/score/${match.fixtureId}/setup`;
        const time = match.kickoffAt
          ? new Intl.DateTimeFormat("en-IN", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: "UTC",
            }).format(new Date(`${match.kickoffAt}:00Z`))
          : "Time not set";
        return (
          <article
            key={match.fixtureId}
            className={`score-card ${index === 0 ? "score-hero" : "score-compact"}`}
          >
            <div className="score-card-caption">
              <span className="score-cap">
                {match.fixtureNumber} · {time}
              </span>
              <span className="score-cap">{match.groundName}</span>
            </div>
            <div className="score-teams">
              {match.teams.map((team) => (
                <div className="score-team" key={team.id}>
                  <TeamShield
                    initials={initialsOf(team.name)}
                    color={team.color ?? null}
                    size={index === 0 ? 34 : 26}
                  />
                  <strong>{team.name}</strong>
                </div>
              ))}
            </div>
            {outcome?.status === "unstarted" && (
              <p role="status">Team information saved · connect to complete setup</p>
            )}
            {outcome?.status === "failed" && (
              <div>
                <p role="alert">{outcome.message}</p>
                <Button
                  variant="secondary"
                  disabled={preparing}
                  onClick={() => {
                    void runPreparation([match.fixtureId]);
                  }}
                >
                  Retry preparation
                </Button>
              </div>
            )}
            {index === 0 ? (
              <>
                <div className="score-chips">
                  <span>{match.format.label}</span>
                  {conditionsLine(match.conditions)
                    .split(" · ")
                    .filter(Boolean)
                    .map((text, i) => (
                      <span key={i}>{text}</span>
                    ))}
                  {match.conditions.ground && <span>{match.conditions.ground} ground</span>}
                </div>
                <div className="score-readiness">
                  <span data-ready={ready}>{ready ? "✓ Both XIs" : "XIs to pick"}</span>
                  <span data-ready={offlineReady}>
                    {offlineReady ? "✓ Works offline" : "Offline not ready"}
                  </span>
                  <span>
                    {match.umpires} {match.umpires === 1 ? "umpire" : "umpires"}
                  </span>
                </div>
                <ButtonLink href={href} size="lg" className="score-primary">
                  <small>{started ? "Match underway" : ready ? "Ready" : "Pick your XIs"}</small>
                  <strong>
                    {match.phase && match.phase !== "not_started"
                      ? "Resume scoring"
                      : "Start scoring"}
                  </strong>
                </ButtonLink>
              </>
            ) : (
              <div className="score-one-action">
                <p>
                  {started
                    ? "Scoring has started"
                    : missing
                      ? `${missing.name} haven't picked their XI`
                      : "Both XIs are ready"}
                </p>
                <ButtonLink href={href} variant="secondary" size="touch">
                  {started ? "Resume" : missing ? "Pick XI" : "Set up"}
                </ButtonLink>
              </div>
            )}
          </article>
        );
      })}
      {QUICK_MATCH_AVAILABLE.enabled && (
        <ButtonLink href="/score/new" variant="secondary">
          Quick match
        </ButtonLink>
      )}
    </div>
  );
}
