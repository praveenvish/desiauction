import { useState } from "react";
import { Button, Dialog } from "@desiauction/ui";
import type { Conditions, EventPayloads, MatchState, NameBook } from "@desiauction/core/scoring";
import type { LocalEntry } from "../use-match";
import { menuItems } from "./menu-model";
export type ShotMode = "every" | "boundaries" | "off";
export type ScoreTheme = "auto" | "daylight" | "floodlight";
export function MenuSheet({
  state,
  names,
  organiser,
  shotMode,
  onShotMode,
  onTheme,
  onClose,
  onEvent,
  onRevise,
  onHandover,
}: {
  state: MatchState;
  names: NameBook;
  organiser: boolean;
  shotMode: ShotMode;
  onShotMode: (mode: ShotMode) => void;
  onTheme: (theme: ScoreTheme) => void;
  onClose: () => void;
  onEvent: (entry: LocalEntry) => void;
  onRevise: () => void;
  onHandover: () => void;
}) {
  const [section, setSection] = useState("home"),
    [reason, setReason] = useState("");
  const teamIds = state.teams ? [state.teams.home, state.teams.away] : [];
  const [teamId, setTeamId] = useState(teamIds[0] ?? "");
  const [penalty, setPenalty] = useState<EventPayloads["penalty_runs"]["reason"]>("fielding");
  const [outId, setOutId] = useState(""),
    [inId, setInId] = useState(""),
    [kind, setKind] = useState<EventPayloads["substitute"]["kind"]>("injury");
  const [interrupt, setInterrupt] = useState<EventPayloads["interrupt"]["reason"]>("rain");
  const [conditions, setConditions] = useState<Conditions>(state.conditions);
  const items = menuItems(organiser, Boolean(state.interrupted));
  const labels: Record<string, string> = {
    "shot-map": "Shot map",
    theme: "Theme",
    penalty: "Penalty runs",
    substitute: "Substitute",
    resume: "Resume play",
    interrupt: "Pause play",
    revise: "Shorten innings",
    conditions: "Ball, pitch or lights changed",
    "no-result": "No result",
    restart: "Restart match",
    void: "Void the match",
  };
  function submit() {
    if (section === "penalty")
      onEvent({ type: "penalty_runs", payload: { teamId, runs: 5, reason: penalty } });
    if (section === "substitute")
      onEvent({ type: "substitute", payload: { teamId, inId, outId, kind } });
    if (section === "interrupt")
      onEvent({
        type: "interrupt",
        payload: { reason: interrupt, ...(reason.trim() ? { note: reason.trim() } : {}) },
      });
    if (section === "conditions") onEvent({ type: "conditions_changed", payload: { conditions } });
    if (section === "no-result")
      onEvent({ type: "abandon", payload: { kind: "no_result", reason: reason.trim() } });
    if (section === "restart") onEvent({ type: "restart", payload: { reason: reason.trim() } });
    if (section === "void" && organiser)
      onEvent({ type: "match_voided", payload: { reason: reason.trim() } });
  }
  const needsReason = ["no-result", "restart", "void"].includes(section);
  const immediate = ["home", "theme", "shot-map"].includes(section);
  return (
    <Dialog
      open
      onClose={onClose}
      title={section === "home" ? "Match options" : (labels[section] ?? "Match options")}
      footer={
        immediate ? undefined : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSection("home");
              }}
            >
              Back
            </Button>
            <Button
              disabled={
                (needsReason && !reason.trim()) || (section === "substitute" && (!inId || !outId))
              }
              onClick={submit}
            >
              {section === "restart"
                ? "Confirm restart"
                : section === "void"
                  ? "Confirm void"
                  : section === "no-result"
                    ? "Confirm no result"
                    : "Save change"}
            </Button>
          </>
        )
      }
    >
      {section === "home" && (
        <div className="scoring-menu-rows">
          <Button variant="ghost" data-testid="handover-open" onClick={onHandover}>
            Hand over scoring
          </Button>
          {items.map((item) => (
            <Button
              key={item}
              variant="ghost"
              data-testid={`menu-${item}`}
              onClick={() => {
                if (item === "resume") onEvent({ type: "resume", payload: {} });
                else if (item === "revise") onRevise();
                else {
                  setReason("");
                  setSection(item);
                }
              }}
            >
              {labels[item]}
            </Button>
          ))}
        </div>
      )}
      {section === "shot-map" && (
        <div className="scoring-sheet-rows">
          {(["every", "boundaries", "off"] as const).map((mode) => (
            <Button
              key={mode}
              variant="ghost"
              aria-pressed={mode === shotMode}
              onClick={() => {
                onShotMode(mode);
              }}
            >
              {mode === "every"
                ? "Every scoring shot"
                : mode === "boundaries"
                  ? "Boundaries only"
                  : "Off"}
            </Button>
          ))}
        </div>
      )}
      {section === "theme" && (
        <div className="scoring-sheet-rows">
          {(["auto", "floodlight", "daylight"] as const).map((theme) => (
            <Button
              key={theme}
              variant="ghost"
              data-testid={`menu-theme-${theme}`}
              onClick={() => {
                onTheme(theme);
              }}
            >
              {theme === "auto" ? "Auto" : theme === "floodlight" ? "Floodlight" : "Daylight"}
            </Button>
          ))}
        </div>
      )}
      {["penalty", "substitute"].includes(section) && (
        <label>
          Team
          <select
            value={teamId}
            onChange={(event) => {
              setTeamId(event.target.value);
              setOutId("");
              setInId("");
            }}
          >
            {teamIds.map((id) => (
              <option key={id} value={id}>
                {names.teams[id]?.name ?? "Team"}
              </option>
            ))}
          </select>
        </label>
      )}
      {section === "penalty" && (
        <>
          <p>Add five penalty runs.</p>
          <label>
            Reason
            <select
              value={penalty}
              onChange={(event) => {
                setPenalty(event.target.value as typeof penalty);
              }}
            >
              {["fielding", "helmet", "time_wasting", "pitch_damage", "other"].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {section === "substitute" && (
        <>
          {(["out", "in"] as const).map((side) => (
            <label key={side}>
              {side === "out" ? "Leaving player" : "Incoming substitute"}
              <select
                value={side === "out" ? outId : inId}
                onChange={(event) => {
                  if (side === "out") setOutId(event.target.value);
                  else setInId(event.target.value);
                }}
              >
                <option value="">Choose a player</option>
                {(side === "out"
                  ? state.lineups[teamId]?.battingOrder
                  : state.lineups[teamId]?.substitutes
                )?.map((id) => (
                  <option key={id} value={id}>
                    {names.players[id]?.name ?? "Player"}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Substitution kind
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
              }}
            >
              {["injury", "concussion", "impact", "tactical"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {section === "interrupt" && (
        <label>
          Reason
          <select
            value={interrupt}
            onChange={(event) => {
              setInterrupt(event.target.value as typeof interrupt);
            }}
          >
            <option value="rain">Rain</option>
            <option value="bad_light">Bad light</option>
            <option value="other">Other</option>
          </select>
        </label>
      )}
      {section === "conditions" && (
        <>
          {(["timeOfDay", "pitch"] as const).map((key) => (
            <label key={key}>
              {key === "timeOfDay" ? "Light" : "Pitch"}
              <select
                value={conditions[key] ?? ""}
                onChange={(event) => {
                  setConditions((previous) => ({ ...previous, [key]: event.target.value }));
                }}
              >
                {(key === "timeOfDay"
                  ? ["day", "day_night", "night"]
                  : ["turf", "matting", "astroturf", "cement"]
                ).map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Ball
            <select
              value={conditions.ball?.type ?? "leather"}
              onChange={(event) => {
                const type = event.target.value as NonNullable<Conditions["ball"]>["type"];
                setConditions((previous) => ({
                  ...previous,
                  ball: type === "leather" ? { type, colour: "white" } : { type },
                }));
              }}
            >
              {["leather", "tennis", "tape", "rubber"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          {conditions.ball?.type === "leather" && (
            <label>
              Ball colour
              <select
                value={conditions.ball.colour ?? "white"}
                onChange={(event) => {
                  const colour = event.target.value as "red" | "white" | "pink";
                  setConditions((previous) => ({ ...previous, ball: { type: "leather", colour } }));
                }}
              >
                {["red", "white", "pink"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {section === "no-result" && <p>Runs stay on records, marked no result.</p>}
      {section === "restart" && (
        <p>Start a new attempt. The existing scoring history stays on the match.</p>
      )}
      {section === "void" && (
        <p>The recorded history stays, and this match is excluded from results and standings.</p>
      )}
      {(needsReason || section === "interrupt") && (
        <label>
          {needsReason ? "Reason · required" : "Note · optional"}
          <textarea
            maxLength={300}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
      )}
    </Dialog>
  );
}
