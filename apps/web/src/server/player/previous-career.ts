import { playerPreviousCareers, withTenantDb } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { dbHandle } from "../db";
import { storage } from "../media";
import { logger } from "../logger";

export interface PreviousCareerSummary {
  matches?: number;
  runs?: number;
  wickets?: number;
  fromYear?: number;
  toYear?: number;
  source?: string;
}
/** Only supported summary fields survive; external history never enters scoring. */
export function previousCareerSummary(raw: unknown): PreviousCareerSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const summary: PreviousCareerSummary = {};
  for (const key of ["matches", "runs", "wickets", "fromYear", "toYear"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
    if (
      (key === "fromYear" || key === "toYear") &&
      (value < 1900 || value > new Date().getFullYear())
    )
      return null;
    summary[key] = value;
  }
  if (
    summary.fromYear !== undefined &&
    summary.toYear !== undefined &&
    summary.fromYear > summary.toYear
  )
    return null;
  if (input.source !== undefined) {
    if (typeof input.source !== "string" || input.source.trim().length > 120) return null;
    summary.source = input.source.trim();
  }
  return summary;
}
/** personId is derived from currentSession by callers, never a form control. */
export async function previousCareerFor(personId: string): Promise<PreviousCareerSummary | null> {
  return withTenantDb(dbHandle, { personId }, async (db) => {
    const [row] = await db
      .select({ summary: playerPreviousCareers.summary })
      .from(playerPreviousCareers)
      .where(
        and(
          eq(playerPreviousCareers.personId, personId),
          eq(playerPreviousCareers.sport, "cricket"),
        ),
      )
      .limit(1);
    return row ? previousCareerSummary(row.summary) : null;
  });
}
export async function savePreviousCareer(personId: string, input: unknown): Promise<boolean> {
  const summary = previousCareerSummary(input);
  if (!summary) return false;
  await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .insert(playerPreviousCareers)
      .values({ personId, sport: "cricket", summary, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [playerPreviousCareers.personId, playerPreviousCareers.sport],
        set: { summary, updatedAt: new Date() },
      }),
  );
  return true;
}
export async function deletePreviousCareer(personId: string): Promise<void> {
  const key = await withTenantDb(dbHandle, { personId }, async (db) => {
    const ownRow = and(
      eq(playerPreviousCareers.personId, personId),
      eq(playerPreviousCareers.sport, "cricket"),
    );
    const [row] = await db
      .select({ key: playerPreviousCareers.screenshotKey })
      .from(playerPreviousCareers)
      .where(ownRow)
      .limit(1);
    await db.delete(playerPreviousCareers).where(ownRow);
    return row?.key ?? null;
  });
  if (key) {
    try {
      await storage.delete(key);
    } catch (error) {
      logger().error({ err: error, personId }, "previous_career.screenshot_delete_failed");
    }
  }
}
