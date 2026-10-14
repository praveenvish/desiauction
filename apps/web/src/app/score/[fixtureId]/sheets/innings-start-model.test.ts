import { expect, it } from "vitest";
import { LocalMatch } from "../use-match";
import { startedHistory } from "../match-test-fixture";
import { inningsOpening, inningsStartPayload } from "./innings-start-model";

function closedFirst() {
  const model = new LocalMatch(
    "fixture",
    "scorer",
    startedHistory(),
    () => Promise.resolve(),
    () => undefined,
  );
  model.restore([], "device");
  expect(model.apply("innings_closed", { reason: "declared" })).toBeTruthy();
  return model;
}
const players = { strikerId: "away-1", nonStrikerId: "away-2", bowlerId: "home-1" };
it("allows a lone opener only when the format permits last man standing", () => {
  const state = closedFirst().view().state;
  if (!state.format || !state.lineups.away) throw new Error("Missing format or lineup");
  state.lineups.away.out.push("away-2", "away-3");
  state.format = { ...state.format, lastManStands: true };
  const opening = inningsOpening(state);
  if (!opening) throw new Error("Missing opening");
  expect(
    inningsStartPayload(state, opening.identity, { ...players, nonStrikerId: null }),
  ).toMatchObject({ strikerId: "away-1", nonStrikerId: null });
  state.format = { ...state.format, lastManStands: false };
  expect(() =>
    inningsStartPayload(state, opening.identity, { ...players, nonStrikerId: null }),
  ).toThrow("eligible");
});
it("starts the chase from queued local state and restores its single opening event", async () => {
  const model = closedFirst();
  const state = model.view().state;
  const opening = inningsOpening(state);
  if (!opening) throw new Error("Missing opening");
  const payload = inningsStartPayload(state, opening.identity, players);
  expect(payload).toEqual({ inningsNo: 2, battingTeamId: "away", ...players });
  expect(model.apply("innings_started", payload)).toBeTruthy();
  await model.whenDurable();
  const restored = new LocalMatch(
    "fixture",
    "scorer",
    startedHistory(),
    () => Promise.resolve(),
    () => undefined,
  );
  restored.restore(model.items, "device");
  expect(restored.view().state.innings).toHaveLength(2);
  expect(restored.view().state.phase).toBe("live");
  expect(restored.items.filter((item) => item.event.type === "innings_started")).toHaveLength(1);
  expect(() => inningsStartPayload(restored.view().state, opening.identity, players)).toThrow(
    "innings changed",
  );
});
it("refuses stale attempt/team and invalid or repeated openers and opposing bowlers", () => {
  const model = closedFirst();
  const state = model.view().state;
  const opening = inningsOpening(state);
  if (!opening) throw new Error("Missing opening");
  expect(() => inningsStartPayload(state, { ...opening.identity, attempt: 2 }, players)).toThrow(
    "innings changed",
  );
  expect(() =>
    inningsStartPayload(state, { ...opening.identity, battingTeamId: "home" }, players),
  ).toThrow("innings changed");
  for (const invalid of [
    { ...players, nonStrikerId: players.strikerId },
    { ...players, nonStrikerId: null },
    { ...players, strikerId: "missing" },
    { ...players, bowlerId: "away-3" },
  ])
    expect(() => inningsStartPayload(state, opening.identity, invalid)).toThrow("eligible");
  const substituted = structuredClone(state);
  const away = substituted.lineups.away;
  if (!away) throw new Error("Missing away lineup");
  away.out.push("away-1");
  expect(() => inningsStartPayload(substituted, opening.identity, players)).toThrow("eligible");
});
it("uses fresh-innings eligibility without previous dismissal or quota exclusions", () => {
  const state = closedFirst().view().state;
  const first = state.innings[0];
  if (!first) throw new Error("Missing first innings");
  first.outIds.push("home-1");
  const opening = inningsOpening(state);
  if (!opening) throw new Error("Missing opening");
  expect(opening.bowlers).toContain("home-1");
  expect(inningsStartPayload(state, opening.identity, players).bowlerId).toBe("home-1");
});
it("sets the super-over flag only for an actual matching pending innings", () => {
  const model = closedFirst();
  const opening = inningsOpening(model.view().state);
  if (!opening) throw new Error("Missing opening");
  expect(
    model.apply(
      "innings_started",
      inningsStartPayload(model.view().state, opening.identity, players),
    ),
  ).toBeTruthy();
  expect(model.apply("innings_closed", { reason: "declared" })).toBeTruthy();
  expect(model.apply("super_over_started", {})).toBeTruthy();
  const pending = inningsOpening(model.view().state);
  if (!pending) throw new Error("Missing super-over opening");
  const team = pending.identity.battingTeamId;
  const other = team === "home" ? "away" : "home";
  expect(
    inningsStartPayload(model.view().state, pending.identity, {
      strikerId: `${team}-1`,
      nonStrikerId: `${team}-2`,
      bowlerId: `${other}-1`,
    }).superOver,
  ).toBe(true);
});
