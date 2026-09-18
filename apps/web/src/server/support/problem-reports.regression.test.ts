import {
  createDb,
  newId,
  people,
  problemReportScreenshots,
  problemReports,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  isReportThrottled,
  recordProblemReport,
  validateProblemReport,
  type ProblemReportInput,
} from "./problem-reports";
import { triageProblemReport } from "./report-desk";
import { purgeExpiredProblemReports } from "./report-retention";

/**
 * FR-1 Phase 1 against a real database — the properties only Postgres can
 * prove, each of which would fail silently if merely written down:
 *
 *   1 · The tables carry no RLS, deliberately (a guest can file a report).
 *   2 · A report and its screenshot land together, and the CHECKs refuse what
 *       the server already refuses — a second lock, not the only one.
 *   3 · Deleting a person keeps the report and forgets who filed it.
 *   4 · Triage moves status and stamps the operator together.
 *   5 · The retention promise deletes screenshots at ninety days.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const MARK = "FR1-REGRESSION";
const BASE = "http://localhost:3000";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]);

const created: string[] = [];
const createdPeople: string[] = [];

function input(overrides: Partial<ProblemReportInput> = {}): ProblemReportInput {
  return {
    category: "bug",
    description: `${MARK} the gavel froze on lot 3`,
    replyEmail: "",
    pageUrl: `${BASE}/seasons/x/auction?tab=live`,
    context: { viewport: "390×844 @3x" },
    personId: null,
    requestIp: `198.51.100.${String(Math.floor(Math.random() * 200) + 1)}`,
    screenshot: null,
    ...overrides,
  };
}

async function file(overrides: Partial<ProblemReportInput> = {}): Promise<string> {
  const result = validateProblemReport(input(overrides), BASE);
  if (!result.ok) {
    throw new Error(result.message);
  }
  const id = await recordProblemReport(db, result.value);
  created.push(id);
  return id;
}

async function person(): Promise<string> {
  const id = newId();
  await db
    .insert(people)
    .values({ id, name: `${MARK} Reporter`, email: `fr1-${id.toLowerCase()}@example.test` });
  createdPeople.push(id);
  return id;
}

beforeAll(async () => {
  await db.delete(problemReports).where(like(problemReports.description, `${MARK}%`));
  await db.delete(people).where(like(people.name, `${MARK}%`));
});

afterAll(async () => {
  if (created.length > 0) {
    await db.delete(problemReports).where(inArray(problemReports.id, created));
  }
  if (createdPeople.length > 0) {
    await db.delete(people).where(inArray(people.id, createdPeople));
  }
  await handle.sql.end({ timeout: 5 });
});

describe("FR-1 · the no-RLS decision is deliberate, and asserted", () => {
  it("problem_reports and problem_report_screenshots carry no policies", async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select relname, relrowsecurity from pg_class
          where relkind = 'r' and relname in ('problem_reports', 'problem_report_screenshots')`,
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must stay RLS-free`).toBe(false);
    }
  });
});

describe("FR-1 · a report lands whole", () => {
  it("stores the redacted page, the context and the screenshot bytes", async () => {
    const id = await file({ screenshot: JPEG });
    const [row] = await db.select().from(problemReports).where(eq(problemReports.id, id));
    expect(row?.pageUrl).toBe(`${BASE}/seasons/x/auction`);
    expect(row?.context).toEqual({ viewport: "390×844 @3x" });
    expect(row?.status).toBe("new");
    const [shot] = await db
      .select()
      .from(problemReportScreenshots)
      .where(eq(problemReportScreenshots.reportId, id));
    expect(shot?.contentType).toBe("image/jpeg");
    expect(Buffer.from(shot?.bytes ?? []).equals(Buffer.from(JPEG))).toBe(true);
  });

  it("the size CHECK refuses an image the server should already have refused", async () => {
    const id = await file();
    await expect(
      db.insert(problemReportScreenshots).values({
        reportId: id,
        contentType: "image/jpeg",
        bytes: Buffer.alloc(1024 * 1024 + 1),
      }),
    ).rejects.toThrow();
  });

  it("the triaged-together CHECK refuses a status nobody set", async () => {
    const id = await file();
    await expect(
      db.update(problemReports).set({ status: "fixed" }).where(eq(problemReports.id, id)),
    ).rejects.toThrow();
  });

  it("deleting the report takes its screenshot with it", async () => {
    const id = await file({ screenshot: JPEG });
    await db.delete(problemReports).where(eq(problemReports.id, id));
    const shots = await db
      .select()
      .from(problemReportScreenshots)
      .where(eq(problemReportScreenshots.reportId, id));
    expect(shots).toEqual([]);
  });
});

describe("FR-1 · who filed it", () => {
  it("deleting the person keeps the report and forgets the link", async () => {
    const reporter = await person();
    const id = await file({ personId: reporter });
    await db.delete(people).where(eq(people.id, reporter));
    const [row] = await db.select().from(problemReports).where(eq(problemReports.id, id));
    expect(row).toBeDefined();
    expect(row?.personId).toBeNull();
  });
});

describe("FR-1 · the throttle", () => {
  it("counts per person, and a guest per connection", async () => {
    const reporter = await person();
    const ip = "198.51.100.250";
    await db.delete(problemReports).where(eq(problemReports.requestIp, ip));
    for (let index = 0; index < 10; index += 1) {
      await file({ personId: reporter, requestIp: null });
    }
    expect(await isReportThrottled(db, reporter, null)).toBe(true);
    expect(await isReportThrottled(db, null, ip)).toBe(false);
    for (let index = 0; index < 10; index += 1) {
      await file({ requestIp: ip });
    }
    expect(await isReportThrottled(db, null, ip)).toBe(true);
    // An hour later the same person may report again.
    expect(await isReportThrottled(db, reporter, null, new Date(Date.now() + 61 * 60_000))).toBe(
      false,
    );
  });
});

describe("FR-1 · triage", () => {
  it("moves the status and records the operator in one write", async () => {
    const operator = await person();
    const id = await file();
    const result = await triageProblemReport(id, "fixed", operator);
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(problemReports).where(eq(problemReports.id, id));
    expect(row?.status).toBe("fixed");
    expect(row?.triagedBy).toBe(operator);
    expect(row?.triagedAt).not.toBeNull();
  });

  it("refuses an unknown status, and moving back to new", async () => {
    const operator = await person();
    const id = await file();
    expect((await triageProblemReport(id, "deleted", operator)).ok).toBe(false);
    expect((await triageProblemReport(id, "new", operator)).ok).toBe(false);
    expect((await triageProblemReport(newId(), "fixed", operator)).ok).toBe(false);
  });
});

describe("FR-1 · the retention promise is enforced by code that deletes", () => {
  it("drops a screenshot at ninety days and keeps the report", async () => {
    const id = await file({ screenshot: JPEG, requestIp: "198.51.100.77" });
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    await db
      .update(problemReportScreenshots)
      .set({ createdAt: old })
      .where(eq(problemReportScreenshots.reportId, id));
    await db.update(problemReports).set({ createdAt: old }).where(eq(problemReports.id, id));

    const result = await purgeExpiredProblemReports();
    expect(result.screenshotsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.addressesCleared).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(problemReports).where(eq(problemReports.id, id));
    expect(row).toBeDefined();
    expect(row?.requestIp).toBeNull();
    const shots = await db
      .select()
      .from(problemReportScreenshots)
      .where(eq(problemReportScreenshots.reportId, id));
    expect(shots).toEqual([]);
  });

  it("deletes the report itself at twenty-four months", async () => {
    const id = await file();
    await db
      .update(problemReports)
      .set({ createdAt: new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000) })
      .where(eq(problemReports.id, id));
    await purgeExpiredProblemReports();
    const rows = await db.select().from(problemReports).where(eq(problemReports.id, id));
    expect(rows).toEqual([]);
  });
});
