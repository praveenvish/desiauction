import { expect, it } from "vitest";
import { LocalMatch, acceptedSetup } from "../use-match";
import { startedHistory } from "../match-test-fixture";
import { menuItems, restartSetupEntries, missingRestartSetupEntries } from "./menu-model";
it("hides organiser-only void and shows the current interruption action", () => {
  expect(menuItems(false, false)).not.toContain("void");
  expect(menuItems(true, false)).toContain("void");
  expect(menuItems(false, true)).toContain("resume");
  expect(menuItems(false, true)).not.toContain("interrupt");
});
it("submits restart in the old attempt and seeds only after acknowledgement", async () => {
  const model = new LocalMatch(
    "fixture",
    "scorer",
    startedHistory(),
    () => Promise.resolve(),
    () => undefined,
  );
  model.restore([], "device");
  const restart = model.apply("restart", { reason: "Wrong match setup" });
  if (!restart) throw new Error("Missing restart");
  expect(model.view().state.attempt).toBe(2);
  expect(model.view().setupAccepted).toBe(false);
  const first = await model.batch();
  expect(first?.attempt).toBe(1);
  const entry = first?.items[0];
  if (!entry) throw new Error("Missing batch");
  await model.received({
    events: [...startedHistory(), { ...entry.event, seq: 6 }],
    attempt: 2,
    lastSeq: 6,
    acks: [{ eventId: restart, status: "stored", seq: 6 }],
  });
  const setup = restartSetupEntries(model.view().state, restart);
  expect(setup.map((event) => event.type)).toEqual([
    "match_started",
    "lineup_confirmed",
    "lineup_confirmed",
  ]);
  expect(model.applyBatch(setup)).toHaveLength(3);
  const next = await model.batch();
  expect(next?.attempt).toBe(2);
  expect(next?.items.every((item) => item.event.attempt === 2)).toBe(true);
  expect(model.view().state.toss).toBeNull();
  expect(model.view().setupAccepted).toBe(false);
  if (!next) throw new Error("Missing setup");
  await model.received({
    events: [...model.history, ...next.items.map((item, i) => ({ ...item.event, seq: 7 + i }))],
    attempt: 2,
    lastSeq: 9,
    acks: next.items.map((item, i) => ({
      eventId: item.event.eventId,
      status: "stored",
      seq: 7 + i,
    })),
  });
  expect(model.view().setupAccepted).toBe(true);
});

it("does not enter toss setup after only part of its seed is accepted", () => {
  const events = startedHistory().slice(0, 3);
  expect(acceptedSetup(events.slice(0, 1), 1)).toBe(false);
  expect(acceptedSetup(events.slice(0, 2), 1)).toBe(false);
  expect(acceptedSetup(events, 1)).toBe(true);
  expect(acceptedSetup(events, 2)).toBe(false);
});

it("copies prior canonical styles and resumes only missing acknowledged seeds after reload", () => {
  const model = new LocalMatch(
    "fixture",
    "scorer",
    startedHistory(),
    () => Promise.resolve(),
    () => undefined,
  );
  model.restore([], "device");
  model.apply("style_set", { registrationId: "home-1", battingHand: "left" });
  model.apply("style_set", { registrationId: "away-1", bowlingStyle: "right_arm_medium" });
  const beforeRestart = model.events();
  const restart = model.apply("restart", { reason: "Wrong setup" });
  if (!restart) throw new Error("Missing restart");
  const history = model.events();
  const state = model.view().state;
  const seed = restartSetupEntries(state, restart);
  expect(seed.map((entry) => entry.type)).toEqual([
    "match_started",
    "lineup_confirmed",
    "lineup_confirmed",
    "style_set",
    "style_set",
  ]);
  expect(seed.filter((entry) => entry.type === "style_set").map((entry) => entry.payload)).toEqual([
    { registrationId: "away-1", bowlingStyle: "right_arm_medium" },
    { registrationId: "home-1", battingHand: "left" },
  ]);
  const fresh = new LocalMatch(
    "fixture",
    "scorer",
    history,
    () => Promise.resolve(),
    () => undefined,
  );
  fresh.restore([], "device");
  fresh.applyBatch(seed.slice(0, 4));
  const partial = fresh.events();
  const reloaded = new LocalMatch(
    "fixture",
    "scorer",
    partial,
    () => Promise.resolve(),
    () => undefined,
  );
  reloaded.restore([], "device");
  expect(acceptedSetup(reloaded.history, 2)).toBe(false);
  expect(missingRestartSetupEntries(reloaded.view().state, restart)).toEqual([seed[4]]);
  reloaded.apply("style_set", { registrationId: "away-1", bowlingStyle: "left_arm_medium" });
  expect(missingRestartSetupEntries(reloaded.view().state, restart)).toEqual([seed[4]]);
  reloaded.applyBatch(missingRestartSetupEntries(reloaded.view().state, restart));
  expect(missingRestartSetupEntries(reloaded.view().state, restart)).toEqual([]);
  expect(acceptedSetup(reloaded.events(), 2)).toBe(true);
  expect(reloaded.view().state.styles["away-1"]?.bowlingStyle).toBe("left_arm_medium");
  expect(beforeRestart.some((event) => event.type === "style_set")).toBe(true);
});
