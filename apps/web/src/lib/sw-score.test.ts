import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { expect, it } from "vitest";
const self: { scoringOfflineFixture?: (pathname: string) => string | null } = {};
vm.runInNewContext(
  readFileSync(path.resolve(__dirname, "../../public/sw-score-route.js"), "utf8"),
  { self },
);
const id = "01HZ0000000000000000000000";
it("routes only exact valid fixture pads to the offline shell", () => {
  expect(self.scoringOfflineFixture?.(`/score/${id}`)).toBe(id);
  for (const route of [
    "/score",
    "/score/shell",
    "/score/handover/token",
    `/score/${id}/setup`,
    `/score/${id}/`,
    `/score/${id}?x=1`,
    "/score/../../../account",
    "/account",
    "/score/not-an-id",
    "/score/IIIIIIIIIIIIIIIIIIIIIIIIII",
  ])
    expect(self.scoringOfflineFixture?.(route)).toBeNull();
});
