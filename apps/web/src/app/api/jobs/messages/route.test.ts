import { beforeEach, describe, expect, it, vi } from "vitest";
import { sweepScoring } from "../../../../server/scoring/sweep";
import { drainOutbox } from "../../../../server/messaging/outbox";
import { POST } from "./route";

vi.mock("../../../../env", () => ({ env: { FEEDBACK_JOB_SECRET: "job-test-secret" } }));
vi.mock("../../../../server/logger", () => ({
  logger: () => ({ error: vi.fn() }),
  withRequestId: (_headers: Headers, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../../../server/jobs/job-runs", () => ({
  recordJobRun: (_name: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../../../server/competition/auction-reminders", () => ({
  sweepAuctionReminders: vi.fn().mockResolvedValue({ queued: 0 }),
}));
vi.mock("../../../../server/competition/match-day", () => ({
  sweepMatchDays: vi.fn().mockResolvedValue({ queued: 0 }),
}));
vi.mock("../../../../server/scoring/sweep", () => ({ sweepScoring: vi.fn() }));
vi.mock("../../../../server/messaging/outbox", () => ({
  drainOutbox: vi.fn().mockResolvedValue({ sent: 1 }),
}));
beforeEach(() => vi.clearAllMocks());
describe("authenticated messages job scoring isolation", () => {
  it("still drains when scoring discovery fails", async () => {
    vi.mocked(sweepScoring).mockRejectedValueOnce(new Error("Scoring unavailable"));
    const response = await POST(
      new Request("http://localhost/api/jobs/messages", {
        method: "POST",
        headers: { "x-feedback-job-secret": "job-test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scoring: "failed", drained: { sent: 1 } });
    expect(drainOutbox).toHaveBeenCalledOnce();
  });
  it("does not run scoring or drain for an unauthenticated request", async () => {
    const response = await POST(
      new Request("http://localhost/api/jobs/messages", { method: "POST" }),
    );
    expect(response.status).toBe(404);
    expect(sweepScoring).not.toHaveBeenCalled();
    expect(drainOutbox).not.toHaveBeenCalled();
  });
});
