/**
 * Sign the sweep in as Demo Founder and save the session.
 *
 * Founder carries every capability the product has — org:owner,
 * settlement:controller, finops:controller AND platform:admin — so one
 * session reaches all 79 routes. Role-specific views (what a viewer or a
 * team owner is allowed to SEE) are a separate question the sweep does not
 * answer; that is checked by hand afterwards.
 *
 * The code is read from the database, not from /dev/inbox, for the reason
 * e2e/otp.ts gives: the page is a dev-only SSR round trip and the row is the
 * same fact without it.
 */
import { chromium } from "@playwright/test";
import postgres from "../../../../node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js";
import { mkdirSync } from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";
const PHONE = process.env.AUDIT_PHONE ?? "9999000001";
const E164 = `+91${PHONE}`;
const DB =
  process.env.DATABASE_URL ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

mkdirSync(OUT, { recursive: true });
const sql = postgres(DB);

// The product allows five codes per number per hour. A sweep that is re-run
// while iterating burns that budget in an afternoon and then stalls silently
// at the phone step, so the harness clears its OWN consumption first.
await sql`delete from otp_codes where phone = ${E164}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.getByLabel("Mobile number").fill(PHONE);
await page.getByRole("button", { name: "Send code" }).click();
await page.waitForFunction(
  () => document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
  null,
  { timeout: 20_000 },
);

let code;
for (let i = 0; i < 60 && !code; i++) {
  const [row] =
    await sql`select code from otp_inbox where phone = ${E164} order by created_at desc limit 1`;
  code = row?.code;
  if (!code) await new Promise((r) => setTimeout(r, 200));
}
if (!code) throw new Error(`no OTP minted for ${E164}`);

await page.getByLabel("6-digit code").fill(code);
await page.getByRole("button", { name: "Verify and continue" }).click();
await page
  .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 })
  .catch(async () => {
    console.error("still on login:", page.url());
    console.error((await page.locator("body").innerText()).slice(0, 800));
    throw new Error("login did not complete");
  });

await ctx.storageState({ path: `${OUT}/${process.env.AUDIT_STATE ?? "state"}.json` });
console.log(`signed in as ${E164} -> ${page.url()}`);
await browser.close();
await sql.end();
