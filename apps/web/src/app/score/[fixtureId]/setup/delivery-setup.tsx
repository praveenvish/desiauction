"use client";
import { loadScoringStorage } from "../../../../lib/scoring-storage-loader";
import { Button, ButtonLink, PlayerPortrait, Tabs } from "@desiauction/ui";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Conditions, EventPayloads } from "@desiauction/core/scoring";
import type { ScoringSetup, AcceptedScoringSetup } from "../../../../server/scoring/home";
import {
  battingFirst,
  movePlayer,
  prefillLineup,
  scoringEventId,
  validLineup,
  type SetupTeam,
} from "./setup-model";

import { reuseQuickPlayerAction } from "../../new/actions";
import { readHistory } from "../history";

type Lineup = EventPayloads["lineup_confirmed"];
async function post<T>(url: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { ok?: boolean; message?: string };
  if (!response.ok || result.ok === false)
    throw new Error(result.message ?? "This could not be saved. Try again.");
  return result;
}
function Tiles<T extends string>({
  label,
  values,
  selected,
  onSelect,
  prefix,
}: {
  label: string;
  values: readonly { value: T; label: string }[];
  selected: T | undefined;
  onSelect: (value: T) => void;
  prefix: string;
}) {
  return (
    <fieldset className="score-condition-group">
      <legend className="score-cap">{label}</legend>
      <div className="score-tiles">
        {values.map((item) => (
          <Button
            key={item.value}
            variant="secondary"
            size="touch"
            data-testid={`${prefix}-${item.value}`}
            aria-pressed={selected === item.value}
            onClick={() => {
              onSelect(item.value);
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
export function DeliverySetupFlow({
  setup,
  actorId,
  accepted,
}: {
  setup: ScoringSetup;
  actorId: string;
  accepted: AcceptedScoringSetup | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(setup.phase === "not_started" ? 2 : 0);
  const restored = setup.phase !== "not_started" || Boolean(accepted);
  const [conditions, setConditions] = useState<Conditions>(setup.conditions);
  const [teams, setTeams] = useState<[SetupTeam, SetupTeam]>(setup.teams);
  const [lineups, setLineups] = useState<[Lineup, Lineup]>(
    () =>
      accepted?.lineups ?? [
        prefillLineup(setup.teams[0], setup.format.playersPerSide),
        prefillLineup(setup.teams[1], setup.format.playersPerSide),
      ],
  );
  const [winner, setWinner] = useState(setup.teams[0].id);
  const [decision, setDecision] = useState<"bat" | "bowl">("bat");
  const [openers, setOpeners] = useState({ striker: "", nonStriker: "", bowler: "" });
  const [guestTeam, setGuestTeam] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [createdGuest, setCreatedGuest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<{ deviceId: string; attempt: number; events: unknown[] } | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  function changeLineup(teamIndex: number, change: (lineup: Lineup) => Lineup) {
    setLineups(
      (current) =>
        current.map((lineup, index) => (index === teamIndex ? change(lineup) : lineup)) as [
          Lineup,
          Lineup,
        ],
    );
  }
  async function addPrevious(previousId: string) {
    if (!guestTeam || busy) return;
    setBusy(true);
    setError(null);
    const result = await reuseQuickPlayerAction(setup.fixtureId, guestTeam, previousId);
    if (!result.ok) setError(result.message);
    else {
      const teamId = guestTeam;
      const player = {
        id: result.registrationId,
        name: result.name,
        photoUrl: null,
        style: "",
        isCaptain: false,
        keeper: false,
      };
      setTeams(
        (current) =>
          current.map((team) =>
            team.id === teamId && !team.players.some((p) => p.id === player.id)
              ? { ...team, players: [...team.players, player] }
              : team,
          ) as [SetupTeam, SetupTeam],
      );
      const index = teams.findIndex((team) => team.id === teamId);
      changeLineup(index, (lineup) =>
        lineup.battingOrder.includes(player.id) ||
        lineup.battingOrder.length >= setup.format.playersPerSide
          ? lineup
          : {
              ...lineup,
              battingOrder: [...lineup.battingOrder, player.id],
              captainId: lineup.captainId || player.id,
              keeperId: lineup.keeperId || player.id,
            },
      );
      setGuestTeam(null);
    }
    setBusy(false);
  }
  async function addGuest() {
    if (!guestTeam || !guestName.trim() || busy) return;
    const teamId = guestTeam;
    setBusy(true);
    setError(null);
    try {
      let registrationId = createdGuest;
      if (!registrationId) {
        const result = await post<{ registrationId: string }>(
          `/api/score/${setup.fixtureId}/players`,
          { teamId, name: guestName },
        );
        registrationId = result.registrationId;
        setCreatedGuest(registrationId);
        const player = {
          id: result.registrationId,
          name: guestName.trim(),
          photoUrl: null,
          style: "",
          isCaptain: false,
          keeper: false,
        };
        setTeams(
          (current) =>
            current.map((team) =>
              team.id === teamId ? { ...team, players: [...team.players, player] } : team,
            ) as [SetupTeam, SetupTeam],
        );
        const index = teams.findIndex((team) => team.id === teamId);
        changeLineup(index, (lineup) =>
          lineup.battingOrder.length < setup.format.playersPerSide
            ? {
                ...lineup,
                battingOrder: [...lineup.battingOrder, player.id],
                captainId: lineup.captainId || player.id,
                keeperId: lineup.keeperId || player.id,
              }
            : { ...lineup, substitutes: [...lineup.substitutes, player.id] },
        );
      }
      if (guestPhone.trim())
        await post(
          `/api/score/${setup.fixtureId}/players`,
          {
            registrationId,
            phone: guestPhone,
          },
          "PATCH",
        );
      setCreatedGuest(null);
      setGuestPhone("");
      setGuestName("");
      setGuestTeam(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Player could not be added.");
    } finally {
      setBusy(false);
    }
  }
  const battingTeamId = battingFirst(teams[0].id, teams[1].id, winner, decision);
  const batting = teams.find((t) => t.id === battingTeamId) ?? teams[0];
  const fielding = teams.find((t) => t.id !== batting.id) ?? teams[1];
  const battingLineup = lineups.find((l) => l.teamId === batting.id) ?? lineups[0];
  const fieldingLineup = lineups.find((l) => l.teamId === fielding.id) ?? lineups[1];
  const striker = battingLineup.battingOrder.includes(openers.striker)
    ? openers.striker
    : (battingLineup.battingOrder[0] ?? "");
  const nonStriker =
    battingLineup.battingOrder.includes(openers.nonStriker) && openers.nonStriker !== striker
      ? openers.nonStriker
      : (battingLineup.battingOrder.find((id) => id !== striker) ?? "");
  const bowler = fieldingLineup.battingOrder.includes(openers.bowler)
    ? openers.bowler
    : (fieldingLineup.battingOrder[0] ?? "");
  async function start() {
    if (
      busy ||
      !restored ||
      !lineups.every((l) => validLineup(l, setup.format.playersPerSide)) ||
      !striker ||
      !nonStriker ||
      !bowler
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (!pending.current) {
        const { scoringDevice } = await loadScoringStorage();
        const deviceId = await scoringDevice();
        const result = await post<{ attempt: number; lastSeq: number; phase: string }>(
          `/api/score/${setup.fixtureId}/start`,
          { deviceId, formatKey: setup.format.key, conditions, lineups },
        );
        if (accepted && accepted.attempt !== result.attempt)
          throw new Error("The match attempt changed. Reload setup.");
        if (result.phase !== "not_started") {
          router.push(`/score/${setup.fixtureId}`);
          return;
        }
        const history = await readHistory(setup.fixtureId);
        if (history.attempt !== result.attempt)
          throw new Error("The match attempt changed. Reload setup.");
        const lastClientSeq = Math.max(
          0,
          ...history.events
            .filter((event) => event.actorPersonId === actorId)
            .map((event) => event.clientSeq),
        );
        const payloads: {
          type: "toss" | "innings_started";
          payload: EventPayloads["toss"] | EventPayloads["innings_started"];
        }[] = [
          { type: "toss", payload: { winnerTeamId: winner, decision } },
          {
            type: "innings_started",
            payload: {
              inningsNo: 1,
              battingTeamId: batting.id,
              strikerId: striker,
              nonStrikerId: nonStriker,
              bowlerId: bowler,
            },
          },
        ];
        pending.current = {
          deviceId,
          attempt: result.attempt,
          events: payloads.map((event, index) => ({
            ...event,
            eventId: scoringEventId(),
            attempt: result.attempt,
            v: 1,
            targetEventId: null,
            clientSeq: lastClientSeq + index + 1,
            clientRecordedAt: new Date().toISOString(),
          })),
        };
      }
      const result = await post<{ acks: { status: string; message?: string }[] }>(
        `/api/score/${setup.fixtureId}/events`,
        pending.current,
      );
      const rejected = result.acks.find((ack) => ack.status === "rejected");
      if (rejected) throw new Error(rejected.message ?? "Check the toss and openers.");
      router.push(`/score/${setup.fixtureId}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Match could not be started.");
    } finally {
      setBusy(false);
    }
  }
  function teamXI(team: SetupTeam, index: number) {
    const lineup = lineups[index];
    if (!lineup) return null;
    return (
      <div data-testid={`setup-xi-${team.id}`} className="score-xi">
        <p className="score-hint">
          {team.selectedIds.length
            ? "Prefilled from the picked XI"
            : "Prefilled from the approved squad"}{" "}
          · Drag to reorder, or use the arrow buttons.
        </p>
        <ol className="score-player-list">
          {lineup.battingOrder.map((id, position) => {
            const player = team.players.find((p) => p.id === id);
            if (!player) return null;
            return (
              <li key={id} className="score-player-row">
                <span className="score-order">{position + 1}</span>
                <PlayerPortrait
                  name={player.name}
                  seed={id}
                  src={player.photoUrl}
                  decorative
                  className="score-portrait"
                />
                <span className="score-player-label">
                  <strong>{player.name}</strong>
                  <small>
                    {player.style || "Style not set"}
                    {lineup.captainId === id ? " · C" : ""}
                    {lineup.keeperId === id ? " · WK" : ""}
                  </small>
                </span>
                <span className="score-reorder">
                  <button
                    type="button"
                    draggable
                    aria-label={`Drag ${player.name} to reorder`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const dragged = event.dataTransfer.getData("text/plain");
                      changeLineup(index, (l) => ({
                        ...l,
                        battingOrder: movePlayer(
                          l.battingOrder,
                          dragged,
                          position - l.battingOrder.indexOf(dragged),
                        ),
                      }));
                    }}
                  >
                    ⋮⋮
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${player.name} up`}
                    disabled={position === 0}
                    onClick={() => {
                      changeLineup(index, (l) => ({
                        ...l,
                        battingOrder: movePlayer(l.battingOrder, id, -1),
                      }));
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${player.name} down`}
                    disabled={position === lineup.battingOrder.length - 1}
                    onClick={() => {
                      changeLineup(index, (l) => ({
                        ...l,
                        battingOrder: movePlayer(l.battingOrder, id, 1),
                      }));
                    }}
                  >
                    ↓
                  </button>
                </span>
                <button
                  type="button"
                  className="score-remove"
                  aria-label={`Remove ${player.name} from XI`}
                  onClick={() => {
                    changeLineup(index, (l) => {
                      const order = l.battingOrder.filter((p) => p !== id);
                      return {
                        ...l,
                        battingOrder: order,
                        captainId: l.captainId === id ? (order[0] ?? "") : l.captainId,
                        keeperId: l.keeperId === id ? (order[0] ?? "") : l.keeperId,
                      };
                    });
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
        <div className="score-picker-grid">
          {(["captainId", "keeperId"] as const).map((key) => (
            <label key={key}>
              {key === "captainId" ? "Captain" : "Wicketkeeper"}
              <select
                value={lineup[key]}
                onChange={(event) => {
                  changeLineup(index, (l) => ({ ...l, [key]: event.target.value }));
                }}
              >
                {lineup.battingOrder.map((id) => (
                  <option key={id} value={id}>
                    {team.players.find((p) => p.id === id)?.name ?? "Player"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <details className="score-bench">
          <summary>Squad and substitutes</summary>
          {team.players
            .filter((p) => !lineup.battingOrder.includes(p.id))
            .map((player) => (
              <div key={player.id} className="score-bench-row">
                <span>{player.name}</span>
                <label>
                  <input
                    type="checkbox"
                    checked={lineup.substitutes.includes(player.id)}
                    onChange={(event) => {
                      changeLineup(index, (l) => ({
                        ...l,
                        substitutes: event.target.checked
                          ? [...l.substitutes, player.id]
                          : l.substitutes.filter((id) => id !== player.id),
                      }));
                    }}
                  />{" "}
                  Substitute
                </label>
                <Button
                  size="touch"
                  variant="secondary"
                  disabled={lineup.battingOrder.length >= setup.format.playersPerSide}
                  onClick={() => {
                    changeLineup(index, (l) => ({
                      ...l,
                      battingOrder: [...l.battingOrder, player.id],
                      substitutes: l.substitutes.filter((id) => id !== player.id),
                    }));
                  }}
                >
                  Add to XI
                </Button>
              </div>
            ))}
        </details>
        <Button
          variant="ghost"
          size="touch"
          onClick={() => {
            setGuestTeam(team.id);
            setCreatedGuest(null);
            setGuestName("");
            setGuestPhone("");
            setError(null);
          }}
        >
          + Add player
        </Button>
      </div>
    );
  }
  return (
    <main className="score-setup">
      <header className="score-setup-header">
        {step === 0 ? (
          <ButtonLink href="/score" variant="ghost" size="touch" aria-label="Back to matches">
            ←
          </ButtonLink>
        ) : (
          <Button
            variant="ghost"
            size="touch"
            aria-label="Back one step"
            disabled={busy}
            onClick={() => {
              setStep(step - 1);
              setError(null);
            }}
          >
            ←
          </Button>
        )}
        <span className="score-cap">
          {setup.fixtureNumber} · Step {step + 1} of 3
        </span>
      </header>
      <h1 tabIndex={-1} ref={heading}>
        {["Match conditions", "Playing XI", "Toss"][step]}
      </h1>
      {error && (
        <p className="score-error" role="alert">
          {error}
        </p>
      )}
      <div className="score-setup-body">
        {step === 0 && (
          <section data-testid="setup-conditions">
            <p className="score-hint">
              Filled from the season and {setup.groundName}. Change anything that’s different today.
            </p>
            <Tiles
              label="When"
              prefix="cond-time"
              selected={conditions.timeOfDay}
              values={[
                { value: "day", label: "Day" },
                { value: "day_night", label: "Day–night" },
                { value: "night", label: "Night" },
              ]}
              onSelect={(timeOfDay) => {
                setConditions((c) => ({ ...c, timeOfDay }));
              }}
            />
            <Tiles
              label="Ball · season rule"
              prefix="cond-ball"
              selected={conditions.ball?.type}
              values={[
                { value: "leather", label: "Leather" },
                { value: "tennis", label: "Tennis" },
                { value: "tape", label: "Tape" },
                { value: "rubber", label: "Rubber" },
              ]}
              onSelect={(type) => {
                setConditions((c) => ({
                  ...c,
                  ball: type === "leather" ? { type, colour: c.ball?.colour ?? "white" } : { type },
                }));
              }}
            />
            {conditions.ball?.type === "leather" && (
              <Tiles
                label="Colour"
                prefix="cond-colour"
                selected={conditions.ball.colour}
                values={[
                  { value: "white", label: "White" },
                  { value: "red", label: "Red" },
                  { value: "pink", label: "Pink" },
                ]}
                onSelect={(colour) => {
                  setConditions((c) => ({ ...c, ball: { type: "leather", colour } }));
                }}
              />
            )}
            <Tiles
              label={`Ground · ${setup.groundName}`}
              prefix="cond-ground"
              selected={conditions.ground}
              values={[
                { value: "full", label: "Full" },
                { value: "half", label: "Half" },
                { value: "box", label: "Box" },
                { value: "indoor", label: "Indoor" },
              ]}
              onSelect={(ground) => {
                setConditions((c) => ({ ...c, ground }));
              }}
            />
            <Tiles
              label="Pitch"
              prefix="cond-pitch"
              selected={conditions.pitch}
              values={[
                { value: "turf", label: "Turf" },
                { value: "matting", label: "Matting" },
                { value: "astroturf", label: "Astroturf" },
                { value: "cement", label: "Cement" },
              ]}
              onSelect={(pitch) => {
                setConditions((c) => ({ ...c, pitch }));
              }}
            />
            <div className="score-format">
              <span className="score-cap">Format · season rule</span>
              <strong>
                {setup.format.label} · {setup.format.playersPerSide} a side
                {setup.format.maxOversPerBowler !== null
                  ? ` · ${String(setup.format.maxOversPerBowler)} overs max`
                  : ""}
              </strong>
            </div>
          </section>
        )}
        {step === 1 && (
          <>
            <Tabs
              label="Playing teams"
              tabs={teams.map((team, index) => ({
                id: team.id,
                label: team.name,
                badge: lineups[index]?.battingOrder.length ?? 0,
                content: teamXI(team, index),
              }))}
            />
            {guestTeam && (
              <form
                className="score-guest"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addGuest();
                }}
              >
                <h2>Add a player to {teams.find((t) => t.id === guestTeam)?.name}</h2>
                {setup.previousPlayers && !createdGuest && (
                  <label>
                    Previous player
                    <select
                      value=""
                      disabled={busy}
                      onChange={(event) => {
                        if (event.target.value) void addPrevious(event.target.value);
                      }}
                    >
                      <option value="">Choose a previous player</option>
                      {setup.previousPlayers.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Player name
                  <input
                    value={guestName}
                    maxLength={120}
                    required
                    disabled={createdGuest !== null}
                    onChange={(event) => {
                      setGuestName(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Mobile number (optional)
                  <input
                    type="tel"
                    autoComplete="off"
                    value={guestPhone}
                    maxLength={40}
                    onChange={(event) => {
                      setGuestPhone(event.target.value);
                    }}
                  />
                </label>
                <p className="score-hint">
                  This player joins the approved squad. Add their mobile number so they can see
                  their stats when they sign in.
                </p>
                <Button variant="secondary" size="touch" type="submit" loading={busy}>
                  {createdGuest ? "Link mobile number" : "Add player"}
                </Button>
                <Button
                  variant="ghost"
                  size="touch"
                  disabled={busy}
                  onClick={() => {
                    setGuestTeam(null);
                    setCreatedGuest(null);
                    setGuestName("");
                    setGuestPhone("");
                  }}
                >
                  Cancel
                </Button>
              </form>
            )}
          </>
        )}
        {step === 2 && (
          <section>
            <fieldset className="score-condition-group">
              <legend className="score-cap">Who won the toss?</legend>
              <div className="score-tiles">
                {teams.map((team) => (
                  <Button
                    key={team.id}
                    variant="secondary"
                    size="touch"
                    data-testid={`toss-winner-${team.id}`}
                    aria-pressed={winner === team.id}
                    onClick={() => {
                      setWinner(team.id);
                    }}
                  >
                    {team.name}
                  </Button>
                ))}
              </div>
            </fieldset>
            <Tiles
              label={`${teams.find((t) => t.id === winner)?.name ?? "Winner"} chose to`}
              prefix="toss-decision"
              selected={decision}
              values={[
                { value: "bat", label: "Bat first" },
                { value: "bowl", label: "Bowl first" },
              ]}
              onSelect={setDecision}
            />
            <div className="score-openers">
              <p className="score-cap">{batting.name}’s openers</p>
              {(
                [
                  { key: "striker", value: striker, label: "On strike" },
                  { key: "nonStriker", value: nonStriker, label: "Non-striker" },
                ] as const
              ).map((item) => (
                <label key={item.key} className="score-opener">
                  <PlayerPortrait
                    name={batting.players.find((p) => p.id === item.value)?.name ?? "Player"}
                    seed={item.value}
                    src={batting.players.find((p) => p.id === item.value)?.photoUrl}
                    decorative
                    className="score-portrait"
                  />
                  <span>
                    {item.label}
                    <select
                      value={item.value}
                      onChange={(event) => {
                        setOpeners((o) => ({ ...o, [item.key]: event.target.value }));
                      }}
                    >
                      {battingLineup.battingOrder.map((id) => (
                        <option
                          key={id}
                          value={id}
                          disabled={item.key === "nonStriker" && id === striker}
                        >
                          {batting.players.find((p) => p.id === id)?.name ?? "Player"}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              ))}
            </div>
            <div className="score-openers">
              <p className="score-cap">{fielding.name}’s first bowler</p>
              <label className="score-opener">
                <PlayerPortrait
                  name={fielding.players.find((p) => p.id === bowler)?.name ?? "Player"}
                  seed={bowler}
                  src={fielding.players.find((p) => p.id === bowler)?.photoUrl}
                  decorative
                  className="score-portrait"
                />
                <span>
                  Opening bowler
                  <select
                    value={bowler}
                    onChange={(event) => {
                      setOpeners((o) => ({ ...o, bowler: event.target.value }));
                    }}
                  >
                    {fieldingLineup.battingOrder.map((id) => (
                      <option key={id} value={id}>
                        {fielding.players.find((p) => p.id === id)?.name ?? "Player"}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            </div>
          </section>
        )}
      </div>
      {!restored && (
        <div role="alert">
          <p>Match setup is waiting to sync.</p>
          <ButtonLink href={`/score/${setup.fixtureId}`}>Return to the pad to retry</ButtonLink>
        </div>
      )}
      <footer className="score-sticky">
        <Button
          size="lg"
          className="score-primary"
          loading={busy}
          data-testid={step === 2 ? "setup-start" : undefined}
          disabled={
            !restored ||
            (step > 0 &&
              (!lineups.every((l) => validLineup(l, setup.format.playersPerSide)) ||
                guestTeam !== null))
          }
          onClick={() => {
            if (step < 2) {
              setStep(step + 1);
              setError(null);
            } else void start();
          }}
        >
          <small>
            {step === 0
              ? "Looks right"
              : step === 1
                ? "Both XIs ready"
                : `${batting.name} bat first`}
          </small>
          <strong>
            {step === 0 ? "Confirm conditions" : step === 1 ? "Next: toss" : "Play · first ball"}
          </strong>
        </Button>
      </footer>
    </main>
  );
}
