import type { Phase } from "@desiauction/core/scoring";
import type { PublicPageFacts } from "../../../../../server/scoring/public-page";
import { BRAND_MARK_SVG, SHARE_CARD_COLORS as C } from "../../share-image-card";
export const LIVE_PREVIEW_SIZE = { width: 1200, height: 630 } as const;
const PHASE_BADGES: Record<Phase, string> = {
  not_started: "Waiting",
  toss: "Before play",
  live: "Live",
  innings_break: "Innings break",
  interrupted: "Paused",
  result_reached: "Result reached",
  finished: "Result",
  final: "Result",
  stalled: "Scorer offline",
  no_result: "No result",
  abandoned: "Abandoned",
  walkover: "Walkover",
  void: "Voided",
};
export function previewModel(facts: PublicPageFacts | null) {
  if (!facts) return null;
  const live = facts.initial;
  const innings = live?.innings.at(-1);
  const previous = live?.innings.at(-2);
  const team = (id: string) => facts.teams.find((value) => value.id === id)?.name ?? "Team";
  const striker = live?.batters.find((batter) => batter.onStrike);
  return {
    title: `${facts.season} · ${facts.fixtureNumber}`,
    badge: live ? PHASE_BADGES[live.phase] : "Waiting",
    team: innings
      ? team(innings.battingTeamId)
      : facts.teams.map((value) => value.name).join(" vs "),
    score: innings ? `${String(innings.runs)}/${String(innings.wickets)}` : null,
    overs: innings?.overs ?? null,
    previous: previous
      ? `${innings?.target !== null ? "chasing " : ""}${team(previous.battingTeamId)} ${String(previous.runs)}/${String(previous.wickets)}`
      : null,
    situation: live?.result ?? live?.situation ?? "Waiting for the scorer",
    striker: striker
      ? { name: striker.name, initials: striker.initials, runs: striker.runs, balls: striker.balls }
      : null,
  };
}
export function renderLivePreview(facts: PublicPageFacts | null) {
  const model = previewModel(facts);
  const mark = `data:image/svg+xml;base64,${Buffer.from(BRAND_MARK_SVG).toString("base64")}`;
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: C.surface,
        color: C.heading,
        fontFamily: "Geist Sans",
        padding: 48,
        gap: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "center",
            fontSize: 24,
            color: C.secondary,
          }}
        >
          <span
            style={{
              background: model?.badge === "Live" ? C.open : C.surfaceRaised,
              color: model?.badge === "Live" ? C.onAccent : C.heading,
              borderRadius: 10,
              padding: "10px 16px",
            }}
          >
            {model?.badge ?? "Cricket"}
          </span>
          <span>{model?.title ?? "DesiAuction"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600 }}>
            {model?.team ?? "Live cricket scores"}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
            <span style={{ fontSize: model?.score ? 110 : 48, fontWeight: 600 }}>
              {model?.score ?? "Follow the match"}
            </span>
            {model?.overs ? (
              <span style={{ fontSize: 34, color: C.secondary }}>{model.overs} ov</span>
            ) : null}
          </div>
          {model?.previous ? (
            <div style={{ display: "flex", fontSize: 28, color: C.secondary }}>
              {model.previous}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <span
            style={{
              display: "flex",
              maxWidth: 680,
              padding: "14px 22px",
              borderRadius: 16,
              background: C.accent,
              color: C.onAccent,
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            {model?.situation ?? "Scores, scorecards and match charts"}
          </span>
          <img src={mark} width={56} height={56} alt="DesiAuction" />
        </div>
      </div>
      {model?.striker ? (
        <div
          style={{
            display: "flex",
            alignSelf: "center",
            width: 270,
            flexDirection: "column",
            border: `2px solid ${C.accent}`,
            borderRadius: 28,
            overflow: "hidden",
            background: C.surfaceRaised,
          }}
        >
          <div
            style={{
              display: "flex",
              height: 220,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 90,
              color: C.accent,
            }}
          >
            {model.striker.initials}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 20 }}>
            <span style={{ fontSize: 20, color: C.accent }}>On strike</span>
            <span style={{ fontSize: 28, fontWeight: 600 }}>
              {model.striker.name} {model.striker.runs}* ({model.striker.balls})
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
