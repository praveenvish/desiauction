import { expect, type Browser, type Page } from "@playwright/test";
import { appendFile, readFile } from "node:fs/promises";
import { replayAuction } from "@desiauction/core";
import {
  auditLog,
  auctionEvents,
  auctions,
  bids,
  competitions,
  createDb,
  lots,
  fixtures,
  organizations,
} from "@desiauction/db";
import { and, asc, eq } from "drizzle-orm";
import { scoringSession, seedScoringFixture } from "./scoring-fixtures";
import { issuePaddleTo } from "./auction-tabs";
import { purgeOrg } from "../src/server/test-support/purge-org";
import { auctionValidationEnv } from "./env";
const { databaseUrl } = auctionValidationEnv;

type OwnedStage = { orgId: string; actorId: string; fixtureId: string; slug: string };
function registryPath(value: string) {
  if (!/^\/tmp\/ui-e09-[a-z0-9-]+\.jsonl$/.test(value))
    throw new Error("Invalid owned auction fixture registry");
  return value;
}
function ownedStage(value: unknown): value is OwnedStage {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    ["orgId", "actorId", "fixtureId"].every(
      (key) => typeof row[key] === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(row[key]),
    ) &&
    typeof row.slug === "string" &&
    /^ls1-t10-[0-9a-hjkmnp-tv-z]{26}$/.test(row.slug)
  );
}
/** Only after the owning browser/services stop; existing fixtures are never selected. */
export async function cleanupOwnedAuctionStages(file: string) {
  const rows = (await readFile(registryPath(file), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line));
  if (rows.length > 100 || !rows.every(ownedStage)) throw new Error("Invalid owned stage receipts");
  if (new Set(rows.map((row) => row.orgId)).size !== rows.length)
    throw new Error("Duplicate owned stage receipts");
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    await handle.db.transaction(async (tx) => {
      for (const row of rows) {
        const found = await tx
          .select({ name: organizations.name, slug: organizations.slug })
          .from(organizations)
          .innerJoin(competitions, eq(competitions.orgId, organizations.id))
          .innerJoin(fixtures, eq(fixtures.competitionId, competitions.id))
          .where(
            and(
              eq(organizations.id, row.orgId),
              eq(organizations.createdBy, row.actorId),
              eq(competitions.slug, row.slug),
              eq(competitions.createdBy, row.actorId),
              eq(fixtures.id, row.fixtureId),
              eq(fixtures.createdBy, row.actorId),
            ),
          );
        if (
          found.length !== 1 ||
          found[0]?.name !== `LS1 ${row.orgId}` ||
          found[0].slug !== `ls1-${row.orgId.toLowerCase()}`
        )
          throw new Error("Owned synthetic fixture identity changed");
        await purgeOrg(tx, row.orgId);
      }
    });
    return { organizations: rows.map((row) => row.orgId), count: rows.length };
  } finally {
    await handle.sql.end();
  }
}

export async function canonical(auctionId: string) {
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    const events = await handle.db
      .select()
      .from(auctionEvents)
      .where(eq(auctionEvents.auctionId, auctionId))
      .orderBy(asc(auctionEvents.seq));
    const replay = replayAuction(
      events.map((event) => ({ ...event, payload: event.payload as Record<string, unknown> })),
    );
    if (!replay.ok) throw new Error(`Canonical replay failed: ${replay.reason}`);
    const bidRows = await handle.db.select().from(bids).where(eq(bids.auctionId, auctionId));
    const lotRows = await handle.db.select().from(lots).where(eq(lots.auctionId, auctionId));
    const audit = await handle.db.select().from(auditLog).where(eq(auditLog.subject, auctionId));
    return { events, projection: replay.projection, bids: bidRows, lots: lotRows, audit };
  } finally {
    await handle.sql.end();
  }
}
export async function recovery(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Array<{ commandId: string; state: string; type: string }>>((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => {
          reject(request.error ?? new Error("Recovery database could not open"));
        };
        request.onsuccess = () => {
          const db = request.result;
          const cursor = db.transaction("keyval", "readonly").objectStore("keyval").openCursor();
          const result: Array<{ commandId: string; state: string; type: string }> = [];
          cursor.onerror = () => {
            db.close();
            reject(cursor.error ?? new Error("Recovery database could not be read"));
          };
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) {
              db.close();
              resolve(result);
              return;
            }
            if (typeof row.key === "string" && row.key.startsWith("ls1:auction-recovery:v1:")) {
              const stored: unknown = row.value;
              if (!Array.isArray(stored)) {
                db.close();
                reject(new Error("Malformed recovery record"));
                return;
              }
              for (const item of stored as unknown[]) {
                if (typeof item !== "object" || item === null) {
                  db.close();
                  reject(new Error("Malformed recovery command"));
                  return;
                }
                const command = item as Record<string, unknown>;
                if (
                  typeof command.commandId !== "string" ||
                  typeof command.state !== "string" ||
                  typeof command.type !== "string"
                ) {
                  db.close();
                  reject(new Error("Malformed recovery command identity"));
                  return;
                }
                result.push({
                  commandId: command.commandId,
                  state: command.state,
                  type: command.type,
                });
              }
            }
            row.continue();
          };
        };
      }),
  );
}
export async function settled(page: Page) {
  await expect
    .poll(async () => (await recovery(page)).filter((item) => item.state !== "reviewed").length)
    .toBe(0);
}
export async function stage(browser: Browser, longNames = false, timerSeconds = 120) {
  const data = await seedScoringFixture({ longNames });
  const conductorContext = await browser.newContext({ baseURL: "http://localhost:3050" });
  const ownerContext = await browser.newContext({ baseURL: "http://localhost:3050" });
  try {
    await scoringSession(conductorContext, data.actorToken);
    await scoringSession(ownerContext, data.nextActorToken);
    const conductor = await conductorContext.newPage();
    const owner = await ownerContext.newPage();
    await conductor.goto(`/seasons/${data.slug}/auction`);
    await expect(conductor.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true");
    await conductor.getByLabel("Lot timer (seconds)").fill(String(timerSeconds));
    await conductor.getByLabel("Anti-snipe extension (seconds)").fill("60");
    await conductor.getByTestId("create-auction").click();
    await expect(conductor.getByTestId("auction-status")).toHaveText("scheduled");
    const handle = createDb(databaseUrl, { max: 1 });
    let auctionId: string;
    try {
      const [season] = await handle.db
        .select()
        .from(competitions)
        .where(eq(competitions.slug, data.slug));
      if (!season) throw new Error("Missing synthetic season");
      const registry = auctionValidationEnv.fixtureRegistry;
      if (registry) {
        if (season.createdBy !== data.actorId) throw new Error("Synthetic fixture creator changed");
        await appendFile(
          registryPath(registry),
          JSON.stringify({
            orgId: season.orgId,
            actorId: data.actorId,
            fixtureId: data.fixtureId,
            slug: data.slug,
          } satisfies OwnedStage) + "\n",
          { mode: 0o600 },
        );
      }
      const [auction] = await handle.db
        .select()
        .from(auctions)
        .where(eq(auctions.competitionId, season.id));
      if (!auction || auction.kind !== "real") throw new Error("Missing real auction");
      auctionId = auction.id;
    } finally {
      await handle.sql.end();
    }
    await conductor.goto(`/seasons/${data.slug}/auction/cockpit`);
    await expect(conductor.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true");
    await conductor.getByLabel("Team", { exact: true }).selectOption({ label: "LS1 Royals" });
    await conductor.getByTestId("invite-owner").click();
    await expect(conductor.getByTestId("owner-invite-url")).toContainText("/owner-join/");
    const join = (await conductor.getByTestId("owner-invite-url").textContent())?.trim();
    if (!join) throw new Error("Missing invitation");
    await owner.goto(join);
    await owner.getByTestId("accept-owner-invite").click();
    await expect(owner.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true");
    await conductor.reload();
    await expect(conductor.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true");
    await conductor
      .locator(".owner-row", { hasText: "LS1 Royals" })
      .getByRole("button", { name: "Grant paddle" })
      .click();
    await expect(
      conductor
        .locator(".owner-row", { hasText: "LS1 Royals" })
        .getByText("granted", { exact: true }),
    ).toBeVisible();
    await owner.reload();
    await owner.getByLabel("Team", { exact: true }).selectOption({ label: "LS1 Royals" });
    await expect(owner.getByTestId("claim-paddle")).toBeEnabled();
    await owner.getByTestId("claim-paddle").click();
    await expect(owner.getByTestId("my-paddle")).toBeVisible();
    await settled(owner);
    await conductor.goto(`/seasons/${data.slug}/auction`);
    await expect(conductor.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true");
    await issuePaddleTo(conductor, "LS1 Strikers");
    await conductor.goto(`/seasons/${data.slug}/auction/cockpit`);
    await expect(conductor.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true");
    await conductor.getByTestId("cockpit-queue-lots").click();
    await expect(conductor.getByTestId("queue-L001")).toBeVisible();
    await settled(conductor);
    await conductor.getByTestId("cockpit-open-auction").click();
    await expect(conductor.getByTestId("ribbon-status")).toHaveText("live");
    await settled(conductor);
    await conductor.getByTestId("open-L001").click();
    await expect(owner.getByTestId("bid-next")).toBeEnabled();
    await settled(conductor);
    return { data, auctionId, conductor, owner, conductorContext, ownerContext };
  } catch (error) {
    await conductorContext.close();
    await ownerContext.close();
    throw error;
  }
}
