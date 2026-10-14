import { expect, it, vi } from "vitest";
const events: string[] = [];
let release!: () => void;
let failCleanup = false;
vi.mock("./inbox-events", () => ({ clearInboxWatermarks: () => events.push("inbox") }));
vi.mock("../app/score/storage", () => ({
  clearScoringStorage: async () => {
    events.push("cleanup-start");
    if (failCleanup) throw new Error("Storage unavailable");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    events.push("cleanup-end");
  },
}));
import { scoringSignOut } from "./scoring-sign-out";
it("awaits scoring cleanup before invoking the session-revoking action", async () => {
  const logout = vi.fn(() => {
    events.push("logout");
    return Promise.resolve();
  });
  const result = scoringSignOut(logout);
  await vi.waitFor(() => {
    expect(events).toContain("cleanup-start");
  });
  expect(logout).not.toHaveBeenCalled();
  release();
  await result;
  expect(events).toEqual(["inbox", "cleanup-start", "cleanup-end", "logout"]);
});

it("does not revoke the session when awaited cleanup fails", async () => {
  failCleanup = true;
  const logout = vi.fn();
  await expect(scoringSignOut(logout)).rejects.toThrow("Storage unavailable");
  expect(logout).not.toHaveBeenCalled();
});
