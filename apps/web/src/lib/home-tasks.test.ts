import { describe, expect, it } from "vitest";
import { rankHomeTasks, rankLiveScopes, type HomeTask } from "./home-tasks";

const task = (
  id: string,
  priority: HomeTask["priority"],
  dueAt: string | null = null,
): HomeTask => ({
  id,
  priority,
  dueAt,
  kind: "score",
  scope: { fixtureId: id },
  state: "live",
  title: id,
  context: id,
  explanation: "Current reader fact",
  action: "Open",
  href: `/score/${id}`,
  completion: "Accepted terminal state",
  retention: "scoring-queue",
});
describe("all-scope Home task recommendation", () => {
  it("keeps every simultaneous live duty, with conductor then held scorer then owner", () => {
    const input = [
      task("owner", "owner-live"),
      task("scorer-b", "score-held"),
      task("setup", "today"),
      task("conduct", "conduct-live"),
      task("scorer-a", "score-held"),
    ];
    const ranked = rankHomeTasks(input);
    expect(ranked.map((row) => row.id)).toEqual([
      "conduct",
      "scorer-a",
      "scorer-b",
      "owner",
      "setup",
    ]);
    expect(input[0]?.id).toBe("owner");
  });
  it("uses actual times within the same bucket and never creates an overdue time", () => {
    const input = [
      task("unscheduled", "today"),
      task("late", "today", "2026-10-12T18:00"),
      task("early", "today", "2026-10-12T09:00"),
    ];
    expect(rankHomeTasks(input).map((row) => row.id)).toEqual(["early", "late", "unscheduled"]);
    expect(input[0]?.dueAt).toBeNull();
  });
  it("does not change the selected destination or identity when query order changes", () => {
    const input = [task("b", "today"), task("a", "today")];
    expect(rankHomeTasks(input)).toEqual(rankHomeTasks([...input].reverse()));
    expect(rankHomeTasks(input)[0]?.href).toBe("/score/a");
  });
  it("offers an older live scope before a newer scheduled scope in menus", () => {
    const input = [
      { seasonSlug: "new", teamId: "new-team", live: false },
      { seasonSlug: "old", teamId: "old-team", live: true },
    ];
    expect(rankLiveScopes(input)[0]?.teamId).toBe("old-team");
    expect(rankLiveScopes(input)).toEqual(rankLiveScopes([...input].reverse()));
  });
});
