/**
 * UI AUDIT SCREENSHOT HARNESS (local dev tool, not part of the product).
 *
 * Logs in as the seeded demo identities via the real /login flow (reading the
 * OTP from otp_inbox the same way e2e/otp.ts does), then captures full-page
 * screenshots of a route list at desktop and mobile widths.
 *
 * Run from apps/web:
 *   node --env-file-if-exists=../../.env.local node_modules/tsx/dist/cli.mjs \
 *     scripts/ui-audit-shots.ts --out /path/to/dir [--only guest,viewer] [--routes /home,/account]
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createDb, otpCodes, otpInbox } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env["AUDIT_BASE_URL"] ?? "http://localhost:3000";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

const argv = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const OUT = arg("out") ?? path.resolve("ui-audit-shots");
const ONLY = arg("only")?.split(",");
const ROUTES_OVERRIDE = arg("routes")?.split(",");
const THEME = arg("theme"); // "floodlight" | "daylight" — omitted = whatever the app defaults to

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

type RoleDef = { role: string; phone: string | null; routes: string[] };

const ROLES: RoleDef[] = [
  {
    role: "guest",
    phone: null,
    routes: [
      "/",
      "/features",
      "/pricing",
      "/gallery",
      "/about",
      "/blog",
      "/careers",
      "/case-studies",
      "/contact",
      "/help",
      "/legal",
      "/releases",
      "/rules-guidelines",
      "/security",
      "/support",
      "/search",
      "/search?q=auction",
      "/api-docs",
      "/schedule-demo",
      "/login",
      "/c",
    ],
  },
  {
    role: "viewer",
    phone: "9999000007",
    routes: ["/home", "/account", "/inbox", "/me/cricket", "/money", "/tournaments", "/orgs"],
  },
  {
    role: "organizer",
    phone: "9999000003",
    routes: [
      "/home",
      "/orgs",
      "/org/demo-club",
      "/org/demo-club/money",
      "/org/demo-club/money/deliveries",
      "/org/demo-club/money/reconciliation",
      "/org/demo-club/settlement",
      "/org/demo-club/venues",
      "/tournaments",
      "/seasons/demo-premier-league",
      "/seasons/demo-premier-league/registrations",
      "/seasons/demo-premier-league/teams",
      "/seasons/demo-premier-league/readiness",
      "/seasons/demo-premier-league/fixtures",
      "/seasons/demo-premier-league/fixtures/calendar",
      "/seasons/demo-premier-league/standings",
      "/seasons/demo-premier-league/posters",
      "/seasons/demo-premier-league/money",
      "/seasons/demo-cup-settled",
      "/seasons/demo-cup-settled/money",
      "/seasons/demo-cup-settled/auction/replay",
      "/seasons/demo-cup-settled/auction/ledger",
      "/seasons/demo-cup-settled/auction/board",
    ],
  },
  {
    role: "founder",
    phone: "9999000001",
    routes: [
      "/seasons/demo-cup-settled/auction/replay",
      "/seasons/demo-cup-settled/auction/ledger",
      "/seasons/demo-cup-settled/auction/board",
      "/seasons/demo-cup-settled/auction/cockpit",
      "/seasons/demo-cup-settled/auction/live",
      "/seasons/demo-cup-settled/auction/overlay",
      "/seasons/demo-cup-settled/auction/spectate",
      "/seasons/demo-premier-league/auction",
      "/org/demo-club/settlement",
      "/org/demo-club/money",
      "/money",
    ],
  },
  {
    role: "bidderA",
    phone: "9999000004",
    routes: ["/seasons/demo-premier-league/auction/live"],
  },
  {
    role: "admin",
    phone: "9999000001",
    routes: [
      "/admin",
      "/admin/audit",
      "/admin/health",
      "/admin/messaging",
      "/admin/orgs",
      "/admin/passes",
      "/admin/users",
      "/admin/demos",
      "/admin/demos/availability",
    ],
  },
];

async function latestOtp(phone: string, timeoutMs = 8000): Promise<string> {
  const e164 = phone.startsWith("+") ? phone : `+91${phone}`;
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

async function resetOtpBudget(phone: string): Promise<void> {
  const e164 = phone.startsWith("+") ? phone : `+91${phone}`;
  const handle = createDb(DATABASE_URL);
  try {
    await handle.db.delete(otpCodes).where(eq(otpCodes.phone, e164));
  } finally {
    await handle.sql.end();
  }
}

async function login(browser: Browser, phone: string, statePath: string): Promise<void> {
  await resetOtpBudget(phone);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByTestId("login-form").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
  );
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  } catch (err) {
    await page.screenshot({ path: path.join(OUT, `login-fail-${phone}.png`), fullPage: true });
    throw err;
  }
  await ctx.storageState({ path: statePath });
  await ctx.close();
}

function fileNameFor(route: string, viewport: string): string {
  const safe = route === "/" ? "landing" : route.replace(/^\//, "").replace(/[/?=&]/g, "_");
  return `${safe}@${viewport}.png`;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(700);
}

async function shoot(ctx: BrowserContext, role: string, routes: string[]): Promise<void> {
  if (THEME !== undefined) {
    await ctx.addInitScript(
      `try{localStorage.setItem("da-theme",${JSON.stringify(THEME)})}catch(e){}`,
    );
  }
  const page = await ctx.newPage();
  for (const route of routes) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      try {
        const resp = await page.goto(route, { timeout: 30000 });
        await settle(page);
        // Hide the Next dev toolbar so it doesn't pollute shots.
        await page
          .addStyleTag({ content: "nextjs-portal{display:none!important}" })
          .catch(() => undefined);
        const dir = path.join(OUT, role);
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, fileNameFor(route, vp.name));
        await page.screenshot({ path: file, fullPage: true });
        const status = resp?.status() ?? 0;
        const finalUrl = new URL(page.url());
        const redirected =
          finalUrl.pathname + finalUrl.search !== route ? ` -> ${finalUrl.pathname}` : "";
        console.log(`${role} ${route} [${vp.name}] ${String(status)}${redirected}`);
      } catch (err) {
        console.log(`${role} ${route} [${vp.name}] FAILED: ${String(err)}`);
      }
    }
  }
  await page.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const def of ROLES) {
    if (ONLY && !ONLY.includes(def.role)) continue;
    const routes = ROUTES_OVERRIDE ?? def.routes;
    let ctx: BrowserContext;
    if (def.phone === null) {
      ctx = await browser.newContext({ baseURL: BASE });
    } else {
      const statePath = path.join(OUT, `state-${def.role}.json`);
      if (!existsSync(statePath)) {
        console.log(`logging in ${def.role} (${def.phone})…`);
        await login(browser, def.phone, statePath);
      }
      ctx = await browser.newContext({ baseURL: BASE, storageState: statePath });
    }
    await shoot(ctx, def.role, routes);
    await ctx.close();
  }
  await browser.close();
}

await main();
