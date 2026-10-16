"use client";
import { useEffect, useState } from "react";
import { onScoringStop } from "../storage-events";
import {
  DeliveryPadEntry,
  RallyPadEntry,
  RaidPadEntry,
  TimedPadEntry,
  PlacementPadEntry,
} from "../[fixtureId]/families/pad-entries";
import { readPreparedMatch, type PreparedMatch } from "../[fixtureId]/prepare";
export function OfflinePad() {
  const [prepared, setPrepared] = useState<PreparedMatch | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      onScoringStop(() => {
        setPrepared(null);
        setError("Signed out. Sign in again to open your match.");
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    const fixtureId = location.hash.slice(1);
    void Promise.resolve()
      .then(() => {
        if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(fixtureId))
          throw new Error("Open a match prepared for offline scoring.");
        return readPreparedMatch(fixtureId);
      })
      .then((match) => {
        if (!active) return;
        if (!match)
          setError(
            "This match is not prepared on this phone. Connect and choose Get ready for match day.",
          );
        else setPrepared(match);
      })
      .catch(() => {
        if (active)
          setError("Scoring storage is unavailable. Connect and prepare this match again.");
      });
    return () => {
      active = false;
    };
  }, []);
  if (prepared?.preparation === "unstarted")
    return (
      <main className="score-home" data-testid="offline-unstarted">
        <h1>{prepared.bootstrap.setup.fixtureNumber}</h1>
        <p>Connect to complete match setup</p>
        <p>Your team information is saved. Scoring starts after setup is accepted online.</p>
      </main>
    );
  if (prepared?.bootstrap.setup.family === "placement")
    return (
      <PlacementPadEntry
        fixtureId={prepared.fixtureId}
        actorId={prepared.bootstrap.actorId}
        events={prepared.events}
        names={prepared.bootstrap.names}
        setup={prepared.bootstrap.setup}
        sharePath={prepared.bootstrap.sharePath}
        nextMatch={prepared.bootstrap.nextMatch}
        language={prepared.bootstrap.language}
      />
    );
  if (prepared?.bootstrap.setup.family === "timed")
    return (
      <TimedPadEntry
        fixtureId={prepared.fixtureId}
        actorId={prepared.bootstrap.actorId}
        events={prepared.events}
        names={prepared.bootstrap.names}
        setup={prepared.bootstrap.setup}
        sharePath={prepared.bootstrap.sharePath}
        nextMatch={prepared.bootstrap.nextMatch}
        language={prepared.bootstrap.language}
      />
    );
  if (prepared?.bootstrap.setup.family === "raid")
    return (
      <RaidPadEntry
        fixtureId={prepared.fixtureId}
        actorId={prepared.bootstrap.actorId}
        events={prepared.events}
        names={prepared.bootstrap.names}
        setup={prepared.bootstrap.setup}
        sharePath={prepared.bootstrap.sharePath}
        nextMatch={prepared.bootstrap.nextMatch}
      />
    );
  if (prepared?.bootstrap.setup.family === "rally")
    return (
      <RallyPadEntry
        fixtureId={prepared.fixtureId}
        actorId={prepared.bootstrap.actorId}
        events={prepared.events}
        names={prepared.bootstrap.names}
        setup={prepared.bootstrap.setup}
        sharePath={prepared.bootstrap.sharePath}
        nextMatch={prepared.bootstrap.nextMatch}
      />
    );
  if (prepared)
    return (
      <DeliveryPadEntry
        key={prepared.fixtureId}
        fixtureId={prepared.fixtureId}
        actorId={prepared.bootstrap.actorId}
        events={prepared.events}
        names={prepared.bootstrap.names}
        setup={prepared.bootstrap.setup}
        language={prepared.bootstrap.language}
        sharePath={prepared.bootstrap.sharePath}
        nextMatch={prepared.bootstrap.nextMatch}
      />
    );
  return (
    <main className="score-home">
      <h1>Offline scoring</h1>
      <p role={error ? "alert" : "status"}>{error ?? "Opening saved match…"}</p>
    </main>
  );
}
