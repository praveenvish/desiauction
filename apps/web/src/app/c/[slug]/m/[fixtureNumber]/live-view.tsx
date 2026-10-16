"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { publicFamilyPanel } from "@desiauction/core/scoring/panels";
import dynamic from "next/dynamic";
const PlacementLiveScore = dynamic(() =>
  import("../../../../../components/scoring/placement-panel").then(
    (entry) => entry.PlacementLiveScore,
  ),
);
const TimedLiveScore = dynamic(() =>
  import("../../../../../components/scoring/timed-panel").then((entry) => entry.TimedLiveScore),
);
const RaidLiveScore = dynamic(() =>
  import("../../../../../components/scoring/raid-panel").then((entry) => entry.RaidLiveScore),
);
const RallyLiveScore = dynamic(() =>
  import("../../../../../components/scoring/rally-panel").then((entry) => entry.RallyLiveScore),
);
const RallyGames = dynamic(() =>
  import("../../../../../components/scoring/rally-panel").then((entry) => entry.RallyGames),
);
import { BrandMark } from "../../../../../components/shell/brand";
import { ThemeToggle } from "../../../../../components/shell/theme-toggle";
import type { PublicPageFacts } from "../../../../../server/scoring/public-page";
import { connectLive } from "./live-socket";
import { LivePoll, stale, type LiveObservation } from "./live-poll";
const Scorecard = dynamic(() => import("./scorecard").then((entry) => entry.Scorecard));
const Charts = dynamic(() =>
  import("../../../../../components/scoring/charts").then((entry) => entry.Charts),
);
import { ViewPing } from "./view-ping";
import { TossReminder } from "./toss-reminder";
import { ResultPanel } from "./result-panel";
import "./live.css";
const TABS = ["live", "scorecard", "charts", "squads"] as const;
type Tab = (typeof TABS)[number];
function subscribeLocation(changed: () => void) {
  window.addEventListener("hashchange", changed);
  return () => {
    window.removeEventListener("hashchange", changed);
  };
}
export function LiveView({
  facts,
  signedIn,
  pushKey,
  paintedAt,
  initialTab = "live",
  wsPath,
}: {
  facts: PublicPageFacts;
  signedIn: boolean;
  pushKey: string | null;
  paintedAt: number;
  initialTab?: Tab;
  wsPath?: "/live/ws" | undefined;
}) {
  const [observation, setObservation] = useState<LiveObservation>({
    state: facts.initial,
    ...(facts.clock ? { clock: facts.clock } : {}),
    resultDetails: facts.initialResultDetails ?? null,
    failures: 0,
    changedAt: paintedAt,
  });
  const [now, setNow] = useState(paintedAt);
  const [tab, setTab] = useState<Tab>(
    (facts.family === "raid" || facts.family === "timed" || facts.family === "placement") &&
      initialTab !== "squads"
      ? "live"
      : initialTab,
  );
  const liveUrl = useSyncExternalStore(
    subscribeLocation,
    () => window.location.href.split("#")[0] ?? null,
    () => null,
  );
  const latest = useRef(observation);
  const state = observation.state;
  const familyPanel = publicFamilyPanel(state);
  const placementPanel = familyPanel?.family === "placement" ? familyPanel.panel : null;
  const raid =
    facts.family === "raid" ||
    familyPanel?.family === "raid" ||
    facts.family === "timed" ||
    familyPanel?.family === "timed" ||
    facts.family === "placement";
  const timedPanel = familyPanel?.family === "timed" ? familyPanel.panel : null;
  const raidPanel = familyPanel?.family === "raid" ? familyPanel.panel : null;
  const rally = facts.family === "rally" || familyPanel?.family === "rally";
  const rallyPanel = familyPanel?.family === "rally" ? familyPanel.panel : null;
  const finishedResult = Boolean(
    state?.result && state.phase !== "result_reached" && state.phase !== "void",
  );
  useEffect(
    () =>
      connectLive(wsPath, facts.fixtureId, facts.proof, (live, clock) => {
        const previous = latest.current;
        const changed = JSON.stringify(previous.state) !== JSON.stringify(live);
        const value = {
          ...previous,
          state: live,
          ...(clock ? { clock, clockObservedAt: performance.now() } : {}),
          failures: 0,
          changedAt: changed ? Date.now() : previous.changedAt,
        };
        latest.current = value;
        setObservation(value);
      }),
    [facts.fixtureId, facts.proof, wsPath],
  );
  useEffect(() => {
    const ping = new ViewPing(`/api/live/${facts.fixtureId}/view`, {
      ...(facts.proof.t ? { t: facts.proof.t } : {}),
      ...(facts.proof.s ? { s: facts.proof.s } : {}),
    });
    ping.start(document.visibilityState === "visible");
    const visibility = () => {
      ping.visibility(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      ping.stop();
    };
  }, [facts.fixtureId, facts.proof.t, facts.proof.s]);
  useEffect(() => {
    const query = new URLSearchParams();
    if (facts.proof.t) query.set("t", facts.proof.t);
    if (facts.proof.s) query.set("s", facts.proof.s);
    if (tab === "scorecard") query.set("view", "scorecard");
    if (tab === "charts") query.set("view", "charts");
    if (tab === "live") query.set("view", "result");
    const poll = new LivePoll(
      `/api/live/${facts.fixtureId}?${query.toString()}`,
      facts.initial,
      (value) => {
        latest.current = value;
        setObservation(value);
      },
      fetch,
      Date.now,
      tab === "scorecard",
      latest.current,
      tab === "charts",
      tab === "live",
    );
    poll.start(document.visibilityState === "visible", tab === "scorecard" || tab === "charts");
    const visibility = () => {
      poll.visibility(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", visibility);
    const clock = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visibility);
      poll.stop();
    };
  }, [facts.fixtureId, facts.initial, facts.proof, tab]);
  useEffect(() => {
    const change = () => {
      const value = window.location.hash.slice(1);
      if (TABS.includes(value as Tab) && (!raid || value === "live" || value === "squads"))
        setTab(value as Tab);
    };
    change();
    window.addEventListener("hashchange", change);
    return () => {
      window.removeEventListener("hashchange", change);
    };
  }, [raid]);
  const innings = state?.innings.at(-1);
  const team = facts.teams.find((side) => side.id === innings?.battingTeamId);
  const age = Math.max(
    0,
    Math.floor((now - Date.parse(state?.updatedAt ?? new Date(paintedAt).toISOString())) / 1000),
  );
  const last = Math.max(
    1,
    Math.floor(
      (now -
        Date.parse(state?.lastBallAt ?? state?.updatedAt ?? new Date(paintedAt).toISOString())) /
        60000,
    ),
  );
  const kickoff = facts.kickoffAt ? Date.parse(`${facts.kickoffAt}+05:30`) : NaN;
  const countdown =
    Number.isFinite(kickoff) && kickoff > now
      ? `${String(Math.floor((kickoff - now) / 3600000)).padStart(2, "0")} HOURS ${String(Math.floor(((kickoff - now) % 3600000) / 60000)).padStart(2, "0")} MIN ${String(Math.floor(((kickoff - now) % 60000) / 1000)).padStart(2, "0")} SEC`
      : "Waiting for the scorer";
  return (
    <main className="live-page" id="main-content" data-section={tab} tabIndex={-1}>
      <a className="live-skip" href="#live-score">
        Skip to score
      </a>
      <header className="live-heading">
        <div className="live-header-row">
          <Link href="/" aria-label="DesiAuction" className="live-brand">
            <BrandMark size={32} />
          </Link>
          <a href={`/c/${facts.slug}`}>
            {facts.season} · {facts.fixtureNumber}
          </a>
          <ThemeToggle />
        </div>
        <h1>
          {facts.family === "placement"
            ? `Lobby · ${facts.fixtureNumber}`
            : facts.teams.map((side) => side.name).join(" vs ")}
        </h1>
        <p>
          {facts.venue ?? "Venue to be announced"}
          {facts.kickoffAt ? ` · ${facts.kickoffAt.replace("T", " ")}` : ""}
        </p>
      </header>
      <section
        className="live-hero"
        aria-label="Match score"
        data-result={finishedResult ? "true" : undefined}
      >
        {finishedResult ? (
          <p role="status" data-testid="live-result" className="result-headline">
            {state?.result}
          </p>
        ) : null}
        <div className="live-status">
          <span>
            {state?.phase === "live"
              ? "Live"
              : state?.result
                ? "Result"
                : state?.phase === "innings_break"
                  ? "Innings break"
                  : state?.phase === "interrupted"
                    ? "Play stopped"
                    : "Match day"}
          </span>
          <span>{state?.conditionsLine ?? ""}</span>
        </div>
        {state ? (
          <p className="live-visible-freshness">
            Visible score updated {age} s ago · {state.trust.replaceAll("_", " ")}
          </p>
        ) : null}
        {placementPanel && state ? (
          <PlacementLiveScore panel={placementPanel} live={state} />
        ) : timedPanel && state && state.family !== "placement" ? (
          <TimedLiveScore
            panel={timedPanel}
            live={state}
            clock={observation.clock}
            observedAt={observation.clockObservedAt}
          />
        ) : raidPanel && state && state.family !== "placement" ? (
          <RaidLiveScore
            panel={raidPanel}
            live={state}
            clock={observation.clock}
            observedAt={observation.clockObservedAt}
          />
        ) : rallyPanel && state && state.family !== "placement" ? (
          <RallyLiveScore panel={rallyPanel} live={state} />
        ) : innings ? (
          <>
            {state?.innings.slice(0, -1).map((previous, index) => (
              <p className="live-previous" key={index}>
                {facts.teams.find((side) => side.id === previous.battingTeamId)?.name}{" "}
                {previous.runs}/{previous.wickets} ({previous.overs})
                {previous.superOver ? " · Super over" : ""}
              </p>
            ))}
            <p className="live-side">{team?.name}</p>
            <div className="live-hero-score">
              <div
                className="live-score"
                data-testid="live-score"
                data-seq={state?.seq}
                id="live-score"
                tabIndex={-1}
              >
                {innings.runs}/{innings.wickets}
                <span>({innings.overs})</span>
              </div>
              {state?.ballsLeft !== null && state?.ballsLeft !== undefined ? (
                <div
                  className="live-balls-left"
                  aria-label={`${String(state.ballsLeft)} balls remaining`}
                >
                  <strong>{state.ballsLeft}</strong>
                  <span>BALLS</span>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <p
            className="live-wait"
            data-testid="live-score"
            data-seq={state?.seq}
            id="live-score"
            tabIndex={-1}
          >
            {state ? countdown : facts.hasMatch ? "Live updates will appear shortly" : countdown}
          </p>
        )}
        {!state?.result && (state?.innings.length ?? 0) > 1 ? (
          <p data-testid="live-situation" className="live-situation">
            {state?.situation ?? "Waiting for the scorer"}
          </p>
        ) : null}
        {state && !state.result && innings ? (
          <p className="live-rates">
            Run rate {state.currentRate}
            {state.requiredRate ? ` · needed ${state.requiredRate}` : ""}
          </p>
        ) : null}
        {state?.result && !finishedResult ? (
          <p role="status" data-testid="live-result">
            {state.result}
          </p>
        ) : null}
        {stale(observation, now) ? (
          <p role="status" data-testid="live-stale">
            Last ball {last} min ago · The scorer has no signal
          </p>
        ) : null}
        {observation.failures >= 2 ? (
          <p role="status" data-testid="live-reconnecting">
            Reconnecting · score may be a few seconds old
          </p>
        ) : null}
      </section>
      <nav className="live-tabs" aria-label="Match sections">
        {TABS.filter(
          (value) =>
            (!rally || value !== "charts") && (!raid || value === "live" || value === "squads"),
        ).map((value) => (
          <a
            key={value}
            href={`#${value}`}
            data-testid={`live-tab-${value}`}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => {
              setTab(value);
            }}
          >
            {value[0]?.toUpperCase()}
            {value.slice(1)}
          </a>
        ))}
      </nav>
      {!rally && !raid && tab === "live" && !finishedResult ? (
        <div className="live-columns">
          <section className="live-panel live-crease">
            <h2>At the crease</h2>
            {state?.batters.length ? (
              <table>
                <caption>Batters</caption>
                <thead>
                  <tr>
                    <th scope="col">Batter</th>
                    <th scope="col">R</th>
                    <th scope="col">B</th>
                    <th scope="col">4s</th>
                    <th scope="col">6s</th>
                  </tr>
                </thead>
                <tbody>
                  {state.batters.map((batter) => (
                    <tr key={batter.id}>
                      <th scope="row">
                        {batter.name}
                        {batter.onStrike ? " *" : ""}
                      </th>
                      <td>{batter.runs}</td>
                      <td>{batter.balls}</td>
                      <td>{batter.fours}</td>
                      <td>{batter.sixes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>The opening batters will appear when play starts.</p>
            )}
            {state?.bowler ? (
              <p className="live-bowler">
                {state.bowler.name} <strong>{state.bowler.figures}</strong>
              </p>
            ) : null}
            <h3>This over</h3>
            <div className="live-balls">
              {state?.thisOver.map((ball, index) => (
                <span key={index}>{ball}</span>
              ))}
            </div>
          </section>
          <section className="live-panel live-recent">
            <h2>Recent balls</h2>
            {state?.recent.length ? (
              <ol className="live-commentary">
                {[...state.recent].reverse().map((ball) => (
                  <li key={ball.seq}>
                    <strong>{ball.over}</strong>
                    <span>{ball.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Ball-by-ball updates will appear here.</p>
            )}
          </section>
        </div>
      ) : null}
      {rallyPanel &&
      state &&
      state.family !== "placement" &&
      (tab === "live" || tab === "scorecard") ? (
        <RallyGames panel={rallyPanel} live={state} />
      ) : null}
      {!rally && !raid && tab === "scorecard" ? (
        <Scorecard
          live={state?.family === "placement" ? null : state}
          card={observation.scorecard}
        />
      ) : null}
      {!rally && tab === "live" && finishedResult && state ? (
        <ResultPanel
          live={state}
          details={observation.resultDetails}
          slug={facts.slug}
          fixtureId={facts.fixtureId}
          signedIn={signedIn}
          liveUrl={liveUrl}
        />
      ) : null}
      {!rally && !raid && tab === "charts" ? (
        <Charts live={state?.family === "placement" ? null : state} charts={observation.charts} />
      ) : null}
      {tab === "squads" ? (
        <div className="live-columns">
          {facts.teams.map((side) => (
            <section className="live-panel" key={side.id}>
              <h2>{side.name}</h2>
              <ul>
                {side.players.map((player) => (
                  <li key={player.id}>
                    {player.name}
                    {player.announced ? " · Announced lineup" : ""}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {!rally && !raid && !state?.innings.length ? (
        <section className="live-panel">
          <h2>Announced lineups</h2>
          {facts.teams.map((side) => (
            <div key={side.id}>
              <h3>{side.name}</h3>
              {side.players.some((player) => player.announced) ? (
                <ul>
                  {side.players
                    .filter((player) => player.announced)
                    .map((player) => (
                      <li key={player.id}>{player.name}</li>
                    ))}
                </ul>
              ) : (
                <p>The lineup has not been announced.</p>
              )}
            </div>
          ))}
          <TossReminder
            fixtureId={facts.fixtureId}
            proof={facts.proof}
            signedIn={signedIn}
            pushKey={pushKey}
          />
        </section>
      ) : null}
      <footer className="live-footer">
        {state ? (
          <p data-testid="live-updated" className="live-updated">
            {state.trust.replaceAll("_", " ")} · Updated {age} s ago
          </p>
        ) : null}
        <nav aria-label="Match navigation">
          <a href={`/c/${facts.slug}`}>Back to season</a>
          {!rally && !raid ? (
            <Link
              href={`/c/${encodeURIComponent(facts.slug)}/m/${encodeURIComponent(facts.fixtureNumber)}/overlay?${new URLSearchParams({ ...facts.proof }).toString()}`}
            >
              Stream overlay
            </Link>
          ) : null}
          {!rally && !raid ? (
            <Link
              href={`/c/${encodeURIComponent(facts.slug)}/m/${encodeURIComponent(facts.fixtureNumber)}/board?${new URLSearchParams({ ...facts.proof }).toString()}`}
            >
              Big-screen board
            </Link>
          ) : null}
          <Link href="/score">Score your own match</Link>
        </nav>
      </footer>
    </main>
  );
}
