import { createDb, newId, people, playerPreviousCareers } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { storage } from "../media";
import { env } from "../../env";
import { previousCareerFor, previousCareerSummary, savePreviousCareer } from "./previous-career";
import { updatePreviousCareerAction } from "./previous-career-actions";
const session = vi.hoisted(() => ({ personId: "" }));
vi.mock("../auth/actions", () => ({
  currentSession: () => Promise.resolve(session.personId ? { personId: session.personId } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const handle = createDb(env.DATABASE_URL);
const a = newId(),
  b = newId();
beforeAll(async () => {
  await handle.db.insert(people).values([
    { id: a, name: "Career A", email: `career-${a}@example.test` },
    { id: b, name: "Career B", email: `career-${b}@example.test` },
  ]);
});
afterAll(async () => {
  await handle.db
    .delete(playerPreviousCareers)
    .where(inArray(playerPreviousCareers.personId, [a, b]));
  await handle.db.delete(people).where(inArray(people.id, [a, b]));
  await handle.sql.end({ timeout: 5 });
});
describe("C37 previous history", () => {
  it("validates supported fields and discards supplied identity and private keys", () => {
    expect(
      previousCareerSummary({
        runs: 20,
        personId: b,
        screenshotKey: "other/key",
        totalPoints: 1000,
      }),
    ).toEqual({ runs: 20 });
    expect(previousCareerSummary({ runs: -1 })).toBeNull();
    expect(previousCareerSummary({ runs: 0.5 })).toBeNull();
    expect(previousCareerSummary({ fromYear: 2025, toYear: 2020 })).toBeNull();
  });
  it("action ignores a forged person field and writes only session owner", async () => {
    await savePreviousCareer(b, { runs: 999 });
    session.personId = a;
    const form = new FormData();
    for (const key of ["matches", "runs", "wickets", "fromYear", "toYear", "source"])
      form.set(key === "source" ? key : `previousCareer_${key}`, key === "runs" ? "20" : "");
    form.set("personId", b);
    expect(await updatePreviousCareerAction({}, form)).toEqual({ saved: true });
    expect(await previousCareerFor(a)).toEqual({ runs: 20 });
    expect(await previousCareerFor(b)).toEqual({ runs: 999 });
    form.set("intent", "delete");
    expect(await updatePreviousCareerAction({}, form)).toEqual({ saved: true });
    expect(await previousCareerFor(a)).toBeNull();
    expect(await previousCareerFor(b)).toEqual({ runs: 999 });
    session.personId = "";
    expect((await updatePreviousCareerAction({}, form)).error).toBeTruthy();
  });
  it("removes only the owner's screenshot after the row deletion commits", async () => {
    await savePreviousCareer(a, { runs: 10 });
    await handle.db
      .update(playerPreviousCareers)
      .set({ screenshotKey: `previous-career/${a}/cricket.png` })
      .where(eq(playerPreviousCareers.personId, a));
    await handle.db
      .update(playerPreviousCareers)
      .set({ screenshotKey: `previous-career/${b}/cricket.png` })
      .where(eq(playerPreviousCareers.personId, b));
    session.personId = a;
    const deleted: string[] = [];
    const removal = vi.spyOn(storage, "delete").mockImplementation(async (key) => {
      expect(await previousCareerFor(a)).toBeNull();
      deleted.push(key);
    });
    const form = new FormData();
    form.set("intent", "delete");
    form.set("personId", b);
    try {
      expect(await updatePreviousCareerAction({}, form)).toEqual({ saved: true });
    } finally {
      removal.mockRestore();
    }
    expect(deleted).toEqual([`previous-career/${a}/cricket.png`]);
    expect(await previousCareerFor(b)).toEqual({ runs: 999 });
  });
});
