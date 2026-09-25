import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { devices, expect, test, type Browser, type BrowserContext } from "@playwright/test";

import { latestOtp, resetOtpBudget } from "../e2e/otp";

/*
 * SCREEN CENSUS — every screen, as the role that uses it, on a laptop and a
 * phone. Records what a reviewer needs to judge a screen without clicking
 * around: status, where it redirected, load time, errors, overflow, headings,
 * and the menu each role is shown. Screenshots go to CENSUS_DIR/<role>/.
 */

const OUT = process.env["CENSUS_DIR"] ?? path.resolve(process.cwd(), "test-results-sim/census");
const S = "tpl-2026-4s7c";
const O = "thane-sports-club-zb7e";
const T = "thane-premier-league-2n7j";

const ROLES: Record<string, { phone: string | null; name: string; routes: string[] }> = {
  visitor: {
    phone: null,
    name: "",
    routes: [
      "/",
      "/features",
      "/pricing",
      "/about",
      "/help",
      "/help/category/getting-started",
      "/legal",
      "/legal/terms",
      "/support",
      "/contact",
      "/careers",
      "/blog",
      "/case-studies",
      "/releases",
      "/security",
      "/rules-guidelines",
      "/api-docs",
      "/schedule-demo",
      "/search",
      "/c",
      `/c/${S}`,
      `/c/${S}/p/RJXN48G`,
      `/c/${S}/t/mumbai-mavericks`,
      `/seasons/${S}/register`,
      `/seasons/${S}/auction/spectate`,
      `/seasons/${S}/auction/board`,
      "/login",
      "/no-such-page",
    ],
  },
  player: {
    phone: "9700010100",
    name: "Arjun Deshmukh",
    routes: [
      "/home",
      "/me",
      "/me/cricket",
      "/inbox",
      "/account",
      `/c/${S}`,
      `/seasons/${S}/register`,
    ],
  },
  owner: {
    phone: "9666178700",
    name: "Aarav Shah",
    routes: [
      "/home",
      `/seasons/${S}/auction/live`,
      `/seasons/${S}/auction/plan`,
      `/seasons/${S}`,
      `/seasons/${S}/teams`,
      "/inbox",
      "/account",
      "/me",
    ],
  },
  organizer: {
    phone: "9123400001",
    name: "Sanjay Patil",
    routes: [
      "/home",
      "/orgs",
      `/org/${O}`,
      `/org/${O}/venues`,
      `/org/${O}/t/${T}`,
      "/tournaments",
      `/tournaments/${T}`,
      "/seasons",
      `/seasons/${S}`,
      `/seasons/${S}/registrations`,
      `/seasons/${S}/lineups`,
      `/seasons/${S}/teams`,
      `/seasons/${S}/fixtures`,
      `/seasons/${S}/fixtures/calendar`,
      `/seasons/${S}/fixtures/match-day`,
      `/seasons/${S}/standings`,
      `/seasons/${S}/auction`,
      `/seasons/${S}/auction/cockpit`,
      `/seasons/${S}/auction/live`,
      `/seasons/${S}/auction/ledger`,
      `/seasons/${S}/auction/replay`,
      `/seasons/${S}/auction/engine`,
      `/seasons/${S}/auction/overlay`,
      `/seasons/${S}/readiness`,
      `/seasons/${S}/money`,
      `/seasons/${S}/posters`,
      `/seasons/${S}/reviews`,
      "/players",
      "/auctions",
      "/reports",
      "/money",
      "/inbox",
      "/account",
    ],
  },
  auctioneer: {
    phone: "9999000006",
    name: "Demo Bidder C",
    routes: ["/home", "/auctions", "/inbox"],
  },
  admin: {
    phone: "9999000001",
    name: "Demo Founder",
    routes: [
      "/admin",
      "/admin/orgs",
      `/admin/orgs/${O}`,
      "/admin/users",
      "/admin/users/01M3BGJG2CEAS1HJSR2W7Y9KX0",
      "/admin/auctions/01M3BHZJFCX505VHS4KH9HGPFH",
      "/admin/live",
      "/admin/audit",
      "/admin/health",
      "/admin/messaging",
      "/admin/notifications",
      "/admin/notifications/analytics",
      "/admin/notifications/suppressions",
      "/admin/notifications/templates",
      "/admin/moderation",
      "/admin/reviews",
      "/admin/reports",
      "/admin/passes",
      "/admin/demos",
      "/admin/demos/availability",
      "/admin/erasure",
      "/admin/newsletter",
      "/home",
    ],
  },
};

interface Row {
  role: string;
  device: string;
  route: string;
  status: number | null;
  finalPath: string;
  ms: number;
  h1: string;
  overflowPx: number;
  pageErrors: string[];
  consoleErrors: string[];
  shot: string;
}

async function signIn(
  browser: Browser,
  phone: string,
  name: string,
  extra = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext(extra);
  const page = await ctx.newPage();
  await resetOtpBudget(phone);
  await page.goto("/login?method=phone");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
  await page.getByLabel("6-digit code").fill(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.close();
  return ctx;
}

test("screen census", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  const rows: Row[] = [];
  const menus: Record<string, unknown> = {};
  const only = process.env["CENSUS_ROLES"]?.split(",");
  for (const [role, cfg] of Object.entries(ROLES)) {
    if (only && !only.includes(role)) continue;
    for (const device of ["laptop", "phone"] as const) {
      const extra =
        device === "phone" ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } };
      const ctx = cfg.phone
        ? await signIn(browser, cfg.phone, cfg.name, extra)
        : await browser.newContext(extra);
      const dir = path.join(OUT, role);
      mkdirSync(dir, { recursive: true });
      for (const route of cfg.routes) {
        const page = await ctx.newPage();
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));
        page.on("console", (m) => {
          if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
        });
        const t0 = Date.now();
        let status: number | null = null;
        try {
          const res = await page.goto(route, { waitUntil: "load", timeout: 45_000 });
          status = res?.status() ?? null;
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
        } catch (e) {
          pageErrors.push(`NAV: ${String(e).slice(0, 150)}`);
        }
        const ms = Date.now() - t0;
        const info = await page
          .evaluate(() => ({
            h1: [...document.querySelectorAll("h1")].map((h) => h.textContent?.trim()).join(" | "),
            overflowPx: document.documentElement.scrollWidth - window.innerWidth,
          }))
          .catch(() => ({ h1: "", overflowPx: 0 }));
        const file = `${device}-${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.png`;
        await page.screenshot({ path: path.join(dir, file), fullPage: true }).catch(() => {});
        if ((route === "/home" || route === "/" || route === "/admin") && device === "laptop") {
          menus[role] = await page
            .evaluate(() => ({
              nav: [...document.querySelectorAll("nav")].map((n) => ({
                label: n.getAttribute("aria-label"),
                links: [...n.querySelectorAll("a,button")]
                  .map((a) => a.textContent?.trim())
                  .filter(Boolean),
              })),
              footer: [...document.querySelectorAll("footer a")].map((a) => a.textContent?.trim()),
            }))
            .catch(() => null);
        }
        rows.push({
          role,
          device,
          route,
          status,
          finalPath: new URL(page.url()).pathname,
          ms,
          ...info,
          pageErrors,
          consoleErrors,
          shot: `${role}/${file}`,
        });
        await page.close();
      }
      await ctx.close();
    }
  }
  writeFileSync(path.join(OUT, "census.json"), JSON.stringify({ rows, menus }, null, 2));
});
