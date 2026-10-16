"use client";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "../../../../../../components/shell/brand";
import type { PublicPageFacts } from "../../../../../../server/scoring/public-page";
import type { PublicOverlay } from "../../../../../../server/scoring/overlay-types";
import { initialPresentation, observeOverlay, overlayStale } from "./model";
import "./overlay.css";

export function OverlayView({
  facts,
  initial,
  board = false,
}: {
  facts: PublicPageFacts;
  initial: PublicOverlay | null;
  board?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [presentation, setPresentation] = useState(() =>
    observeOverlay(initialPresentation(), initial?.overlay ?? null, Date.now()),
  );
  const [now, setNow] = useState(0);
  const lastSuccess = useRef(0);
  const changedAt = useRef(0);
  const scoreVersion = useRef(
    initial ? `${String(initial.live.seq)}-${initial.live.updatedAt}` : null,
  );
  const currentPhase = useRef(initial?.live.phase);
  const model = useRef(presentation);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | null = null;
    let requestStarted = 0;
    let etag: string | null = null;
    lastSuccess.current = Date.now();
    changedAt.current = Date.now();
    const accept = (body: PublicOverlay | null) => {
      const version = body ? `${String(body.live.seq)}-${body.live.updatedAt}` : null;
      if (version !== scoreVersion.current) changedAt.current = Date.now();
      scoreVersion.current = version;
      currentPhase.current = body?.live.phase;
      const updated = overlayStale(
        body?.live.phase,
        Date.now(),
        changedAt.current,
        lastSuccess.current,
      )
        ? initialPresentation()
        : observeOverlay(model.current, body?.overlay ?? null, Date.now());
      model.current = updated;
      setPresentation(updated);
      setValue(body);
    };
    const poll = async () => {
      request = new AbortController();
      requestStarted = Date.now();
      try {
        const query = new URLSearchParams({ ...facts.proof, view: "overlay" });
        const response = await fetch(`/api/live/${facts.fixtureId}?${query.toString()}`, {
          signal: request.signal,
          cache: "no-store",
          headers: etag ? { "If-None-Match": etag } : {},
        });
        if (stopped) return;
        if (response.status === 304) lastSuccess.current = Date.now();
        else if (response.ok) {
          const body = (await response.json()) as PublicOverlay;
          if (body.overlay && body.overlay.seq !== body.live.seq)
            throw new Error("Overlay sequence mismatch");
          lastSuccess.current = Date.now();
          etag = response.headers.get("etag");
          accept(body);
        } else if (response.status === 404) {
          etag = null;
          accept(null);
        } else {
          etag = null;
          model.current = initialPresentation();
          setPresentation(model.current);
        }
      } catch {
        if (!stopped) {
          etag = null;
          model.current = initialPresentation();
          setPresentation(model.current);
        }
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void poll();
          }, 2000);
      }
    };
    timer = setTimeout(() => {
      void poll();
    }, 2000);
    const clock = setInterval(() => {
      setNow(Date.now());
      const tick = Date.now();
      if (tick - lastSuccess.current >= 60000) {
        if (tick - requestStarted >= 60000) request?.abort();
        etag = null;
      }
      if (
        model.current.baseline &&
        overlayStale(currentPhase.current, tick, changedAt.current, lastSuccess.current)
      ) {
        model.current = initialPresentation();
        setPresentation(model.current);
      }
    }, 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
      request?.abort();
    };
  }, [facts.fixtureId, facts.proof]);
  const live = value?.live;
  const innings = live?.innings.at(-1);
  const team = facts.teams.find((side) => side.id === innings?.battingTeamId);
  const sting = now < presentation.expiresAt ? presentation.sting : null;
  const stat = !sting && presentation.baseline && value?.overlay?.betweenOvers ? value.stat : null;
  return (
    <main
      className={`match-overlay${board ? " match-board" : ""}`}
      id="main-content"
      aria-label={board ? "Big-screen match board" : "Stream overlay"}
    >
      <h1 className="overlay-label">
        <span className="overlay-brand" aria-hidden>
          <BrandMark size={32} />
        </span>
        <span className="overlay-match">
          {facts.season} · {facts.fixtureNumber}
        </span>
        <span className="overlay-live">
          {live?.phase === "live" ? "Live" : live?.result ? "Result" : "Waiting"}
        </span>
      </h1>
      {sting && (
        <div
          key={`${String(presentation.baseline?.lastDelivery?.seq)}-${sting}`}
          className="overlay-sting"
          role="status"
        >
          {sting === "four" ? "FOUR" : sting === "six" ? "SIX" : "WICKET"}
        </div>
      )}
      {stat && (
        <aside className="overlay-stat" aria-label="Matchup statistic">
          <small>STAT</small>
          <strong>
            {stat.subject} against {stat.style}: {stat.rate.toFixed(1)} an over
          </strong>
          <p>
            {stat.sample.balls} balls in {stat.sample.matches} matches
          </p>
        </aside>
      )}
      <section className="overlay-score" aria-label="Match score">
        <div className="overlay-score-team">
          <strong>{team?.name ?? "Waiting for the scorer"}</strong>
          <b>{innings ? `${String(innings.runs)}/${String(innings.wickets)}` : "—"}</b>
          <span>{innings ? `Overs ${innings.overs}` : ""}</span>
        </div>
        <div className="overlay-batters">
          {live?.batters.map((batter) => (
            <p key={batter.id}>
              {batter.name}{" "}
              <strong>
                {batter.runs}
                {batter.onStrike ? "*" : ""}
              </strong>{" "}
              ({batter.balls})
            </p>
          ))}
        </div>
        <div className="overlay-bowler">
          <p>
            {live?.bowler ? (
              <>
                {live.bowler.name}
                {live.bowler.style ? ` · ${live.bowler.style.replaceAll("_", " ")}` : ""}
              </>
            ) : (
              "Next bowler not selected"
            )}
          </p>
          <p>{live?.bowler?.figures}</p>
          <p>{live?.thisOver.join(" · ")}</p>
        </div>
        <div className="overlay-target">
          <strong>{live?.result ?? live?.situation ?? "Waiting for the scorer"}</strong>
          {live?.requiredRate && <p>Required rate {live.requiredRate}</p>}
        </div>
        {facts.sponsor && (
          <div className="overlay-sponsor">
            <small>Presented by</small>
            {facts.sponsor.logoUrl && <img src={facts.sponsor.logoUrl} alt="" />}
            <strong>{facts.sponsor.name}</strong>
          </div>
        )}
        <p className="overlay-footer">{live?.conditionsLine ?? ""} · DesiAuction</p>
      </section>
    </main>
  );
}
