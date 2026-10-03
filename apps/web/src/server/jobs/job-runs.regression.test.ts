// A JOB'S RUN IS RECORDED — and a knock at the door is not (AC-1.1), against
// real Postgres.
import { jobRuns } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "../db";
import { recordJobRun } from "./job-runs";

const JOB = `test-${String(Date.now())}`;

async function rows() {
  return db.select().from(jobRuns).where(eq(jobRuns.job, JOB));
}

describe("job_runs", () => {
  it("a refused call (404) leaves no row", async () => {
    await recordJobRun(JOB, () =>
      Promise.resolve(Response.json({ error: "not found" }, { status: 404 })),
    );
    expect(await rows()).toHaveLength(0);
  });

  it("a run is one row with its summary and outcome", async () => {
    const response = await recordJobRun(JOB, () => Promise.resolve(Response.json({ purged: 3 })));
    // The caller still gets the job's own response, body intact.
    expect(await response.json()).toEqual({ purged: 3 });
    const [row] = await rows();
    expect(row).toMatchObject({ ok: true, detail: { purged: 3 } });
    expect(row?.finishedAt).not.toBeNull();
  });

  it("a 200 with a sub-sweep marked failed is recorded as not ok", async () => {
    await recordJobRun(JOB, () =>
      Promise.resolve(Response.json({ purged: 1, registrationDigests: "failed" })),
    );
    const rows = (await db.select().from(jobRuns).where(eq(jobRuns.job, JOB))).filter(
      (row) => (row.detail as Record<string, unknown>)["registrationDigests"] === "failed",
    );
    expect(rows[0]?.ok).toBe(false);
  });

  it("a run that throws is recorded as failed, and still throws", async () => {
    await expect(
      recordJobRun(JOB, () => Promise.reject(new Error("provider down"))),
    ).rejects.toThrow("provider down");
    const thrown = (await rows()).find(
      (row) => (row.detail as Record<string, unknown>)["error"] !== undefined,
    );
    expect(thrown).toMatchObject({ ok: false, detail: { error: "provider down" } });
    await db.delete(jobRuns).where(eq(jobRuns.job, JOB));
  });
});
