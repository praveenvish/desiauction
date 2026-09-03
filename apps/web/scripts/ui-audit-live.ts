/**
 * LIVE-AUCTION STAGING FOR THE UI AUDIT (local dev tool, not part of the product).
 *
 * Drives "Demo Premier League" to a LIVE auction the same way seed-demo stages
 * the settled exemplar (direct certified-writer calls while the engine lease is
 * free), then bids through the real UI in three browsers and captures the live
 * surfaces mid-flight: cockpit, bidder /live (desktop + mobile), public
 * /spectate, venue /board and /overlay — pre-bid, outbid, SOLD ceremony,
 * paused, and an unsold lot.
 *
 * Run from apps/web (dev server + engine must be up):
 *   AUDIT_BASE_URL=http://localhost:3100 node --env-file-if-exists=../../.env.local \
 *     node_modules/tsx/dist/cli.mjs scripts/ui-audit-live.ts --out /path/to/dir
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { DEFAULT_AUCTION_CONFIG } from "@desiauction/core";
import {
  auctionOf,
  createAuction,
  issuePaddle,
  queueAllLots,
  transitionAuction,
  type AuctionRecord,
} from "@desiauction/auction";
import { competitions, createDb, otpCodes, otpInbox, people, teams } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { auctionReady } from "../src/server/auction/auction-ready.js";

const BASE = process.env["AUDIT_BASE_URL"] ?? "http://localhost:3100";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? (argv[outIdx + 1] ?? "ui-audit-live") : path.resolve("ui-audit-live");
const SLUG = "demo-premier-league";

async function latestOtp(phone: string, timeoutMs = 8000): Promise<string> {
  const e164 = `+91${phone}`;
  const handle = createDb(DATABASE_URL);
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const [row] = await handle.db
        .select({ code: otpInbox.code })
        .from(otpInbox)
        .where(eq(otpInbox.phone, e164))
        .orderBy(desc(otpInbox.createdAt))
        .limit(1);
      if (row !== undefined) return row.code;
      if (Date.now() >= deadline) throw new Error(`no OTP minted for ${e164}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

async function login(
  browser: Browser,
  phone: string,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  const handle = createDb(DATABASE_URL);
  try {
    await handle.db.delete(otpCodes).where(eq(otpCodes.phone, `+91${phone}`));
  } finally {
    await handle.sql.end();
  }
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
  );
  await page.getByLabel("6-digit code").fill(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  await page.close();
  return ctx;
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page
    .addStyleTag({ content: "nextjs-portal{display:none!important}" })
    .catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`shot ${name}`);
}

async function stage(): Promise<void> {
  const handle = createDb(DATABASE_URL);
  const db = handle.db;
  try {
    const [comp] = await db.select().from(competitions).where(eq(competitions.slug, SLUG));
    if (comp === undefined) throw new Error("demo-premier-league missing — run seed:demo");
    const existing = await auctionOf(db, comp.id);
    if (existing !== null) {
      console.log(`auction already exists (${existing.status}) — skipping staging`);
      return;
    }
    const [founder] = await db.select().from(people).where(eq(people.phone, "+919999000001"));
    const [bidderA] = await db.select().from(people).where(eq(people.phone, "+919999000004"));
    const [bidderB] = await db.select().from(people).where(eq(people.phone, "+919999000005"));
    if (!founder || !bidderA || !bidderB) throw new Error("demo identities missing");
    await db
      .update(competitions)
      .set({ status: "registration_closed" })
      .where(eq(competitions.id, comp.id));
    const fresh = { ...comp, status: "registration_closed" };
    const ready = await auctionReady(db, fresh as never);
    const created = await createAuction(
      db,
      fresh as never,
      ready,
      founder.id,
      DEFAULT_AUCTION_CONFIG,
    );
    if (!created.ok) throw new Error(`createAuction: ${created.reason}`);
    const auction = (await auctionOf(db, comp.id)) as AuctionRecord;
    const teamRows = await db.select().from(teams).where(eq(teams.competitionId, comp.id));
    const grantees = [bidderA.id, bidderB.id];
    for (const [i, team] of teamRows.slice(0, 2).entries()) {
      const issued = await issuePaddle(db, auction, founder.id, team.id, grantees[i] ?? "");
      if (!issued.ok) throw new Error("issuePaddle failed");
    }
    await queueAllLots(db, auction, founder.id);
    const opened = await transitionAuction(db, auction, founder.id, "open");
    if (!opened.ok) throw new Error(`open: ${opened.reason}`);
    console.log("staged: auction live with 2 granted paddles, all lots queued");
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  await stage();
  const browser = await chromium.launch();
  const desktop = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };

  const founderCtx = await login(browser, "9999000001", desktop);
  const bidderACtx = await login(browser, "9999000004", phone);
  const bidderBCtx = await login(browser, "9999000005", desktop);
  const guestCtx = await browser.newContext({ baseURL: BASE, viewport: desktop });

  const cockpit = await founderCtx.newPage();
  await cockpit.goto(`/seasons/${SLUG}/auction/cockpit`);
  // The conduct controls live on the conductor's /live page (the cockpit
  // mirrors state and holds pause); this page does the opening.
  const conduct = await founderCtx.newPage();
  await conduct.goto(`/seasons/${SLUG}/auction/live`);
  const liveA = await bidderACtx.newPage();
  await liveA.goto(`/seasons/${SLUG}/auction/live`);
  const liveB = await bidderBCtx.newPage();
  await liveB.goto(`/seasons/${SLUG}/auction/live`);
  const spectate = await guestCtx.newPage();
  await spectate.goto(`/seasons/${SLUG}/auction/spectate`);
  const board = await guestCtx.newPage();
  await board.goto(`/seasons/${SLUG}/auction/board`);

  // Hold a paddle each way the product allows: a directly-issued grant arrives
  // already claimed (no claim button ever renders); an unclaimed grant shows
  // "claim-paddle" first.
  try {
    for (const page of [liveA, liveB]) {
      const already = await page
        .getByTestId("my-paddle")
        .waitFor({ timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!already) {
        await page.getByTestId("claim-paddle").click({ timeout: 30000 });
        await page.getByTestId("my-paddle").waitFor({ timeout: 30000 });
      }
    }
  } catch (err) {
    await shot(liveA, "DEBUG-liveA-claim-missing");
    await shot(cockpit, "DEBUG-cockpit-at-claim-fail");
    throw err;
  }
  await shot(liveA, "live-claimed@mobile");

  // Lot 1 opens; everyone sees it.
  await conduct.getByTestId("conduct-open-lot").click({ timeout: 30000 });
  await liveA.getByTestId("current-lot").waitFor({ timeout: 30000 });
  await shot(cockpit, "cockpit-lot-open@desktop");
  await shot(liveA, "live-lot-open@mobile");
  await shot(spectate, "spectate-lot-open@desktop");
  await shot(board, "board-lot-open@desktop");

  // A bids; B sees the rival leading; B bids; A sees OUTBID.
  await liveA.getByTestId("bid-next").click({ timeout: 20000 });
  await liveB
    .getByTestId("leading-team")
    .waitFor({ timeout: 20000 })
    .catch(() => undefined);
  await shot(liveB, "live-rival-leading@desktop");
  await liveB.getByTestId("bid-next").click({ timeout: 20000 });
  await liveA.waitForTimeout(1500);
  await shot(liveA, "live-outbid@mobile");
  await shot(cockpit, "cockpit-bidding@desktop");
  await shot(board, "board-bidding@desktop");

  // The gavel: countdown runs out, ceremony everywhere.
  await liveA.getByTestId("ceremony").waitFor({ timeout: 90000 });
  await shot(liveA, "live-sold@mobile");
  await shot(spectate, "spectate-sold@desktop");
  await shot(cockpit, "cockpit-sold@desktop");
  await shot(board, "board-sold@desktop");

  // Lot 2: pause, look around, resume, let it die quietly → unsold.
  await conduct.getByTestId("conduct-open-lot").click({ timeout: 30000 });
  await liveA.getByTestId("current-lot").waitFor({ timeout: 30000 });
  await cockpit.getByTestId("cockpit-pause").click({ timeout: 20000 });
  await cockpit.waitForTimeout(1200);
  await shot(cockpit, "cockpit-paused@desktop");
  await shot(liveA, "live-paused@mobile");
  await shot(spectate, "spectate-paused@desktop");
  await cockpit.getByTestId("cockpit-pause").click({ timeout: 20000 });
  await liveA
    .getByTestId("ceremony")
    .waitFor({ timeout: 90000 })
    .catch(() => undefined);
  await shot(liveA, "live-unsold@mobile");
  await shot(spectate, "spectate-unsold@desktop");
  await shot(cockpit, "cockpit-after-unsold@desktop");

  await browser.close();
  console.log("done — auction left LIVE with remaining lots queued");
}

await main();
