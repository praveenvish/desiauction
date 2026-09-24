/**
 * Marketing showcase capture (local tool).
 * Runs a real practice auction with fictional names on the local platform and
 * screenshots the real screens at the moments a homepage wants to show.
 *
 *   node --env-file-if-exists=../../.env.local node_modules/tsx/dist/cli.mjs scripts/capture-marketing-screens.ts <outDir>
 *
 * Needs the engine (:4000) and a web server (SHOWCASE_BASE, default :3070)
 * running against the local database; it creates a new club each run. The
 * homepage images in public/marketing/product/ are board.png →
 * auction-board.webp, owner-paddle-live.png → owner-phone-bidding.webp and
 * owner-paddle-sold.png → owner-phone-sold.webp, resized with sharp. Give a
 * refreshed image a NEW file name: the image optimizer and any CDN cache by URL.
 */
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { latestOtp } from "../e2e/otp";

const BASE = process.env["SHOWCASE_BASE"] ?? "http://localhost:3070";
const OUT = process.argv[2] ?? "showcase-out";
mkdirSync(OUT, { recursive: true });
const STAMP = String(Date.now()).slice(-7);

const TEAMS = ["Falcons", "Voyagers", "Titans", "Strikers"];
/** The player the homepage features: on the block, the fight and the SOLD. */
const FEATURED = "Praveen Vishnoi";
const PLAYERS: [string, string, string][] = [
  [FEATURED, "all_rounder", "A"],
  ["Riya Mehta", "all_rounder", "A"],
  ["Aarav Shah", "batter", "A"],
  ["Kabir Nair", "bowler", "A"],
  ["Ishaan Rao", "wicket_keeper", "B"],
  ["Neel Kapoor", "batter", "B"],
  ["Meera Iyer", "bowler", "B"],
  ["Arjun Pawar", "all_rounder", "B"],
  ["Dev Malhotra", "batter", "C"],
  ["Tara Menon", "bowler", "C"],
  ["Rohan Bhatt", "all_rounder", "C"],
  ["Ananya Gupta", "batter", "C"],
  ["Vihaan Joshi", "bowler", "C"],
  ["Sneha Kulkarni", "wicket_keeper", "C"],
  ["Aditya Patil", "batter", "C"],
  ["Pooja Reddy", "all_rounder", "C"],
  ["Siddharth Mishra", "bowler", "C"],
];

const HIDE_DEV = `nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }`;

async function newPage(
  browser: Browser,
  mobile = false,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          baseURL: BASE,
        }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, baseURL: BASE },
  );
  await ctx.addInitScript((css) => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
    });
  }, HIDE_DEV);
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  return { ctx, page };
}

async function login(page: Page, phone: string, name: string): Promise<void> {
  await page.goto("/login?method=phone");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log("shot", name);
}

async function holdClose(page: Page): Promise<void> {
  await page.getByTestId("conduct-close-lot").hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
}

const browser = await chromium.launch();
try {
  // --- Organizer: club, season, teams ---------------------------------------
  const { page: org } = await newPage(browser);
  await login(org, `86${STAMP}0`, "Vikram Desai");
  await org.goto("/orgs");
  await org.getByTestId("new-org").click();
  await org.getByLabel("Organization name").filter({ visible: true }).fill("Sunday Smashers Club");
  await org.getByRole("button", { name: "Create organization" }).click();
  await expect(org.getByTestId("org-name")).toBeVisible();

  await org.goto("/seasons");
  await org.getByTestId("new-season").click();
  await org.getByLabel("Season name").filter({ visible: true }).fill("Sunday Smashers League 2026");
  await org.getByLabel("Location").fill("Andheri, Mumbai");
  await org.getByLabel("Starts on").fill("2026-11-01");
  await org.getByLabel("Ends on").fill("2026-12-20");
  await org.getByRole("button", { name: "Create season" }).click();
  await expect(org.getByTestId("competition-status")).toHaveText("draft");
  const seasonUrl = org.url();
  const slug = new URL(seasonUrl).pathname.split("/")[2] ?? "";
  console.log("slug", slug);

  await org.goto(`${seasonUrl}/teams`);
  for (const team of TEAMS) {
    await org.getByTestId("open-add-team").click();
    await org.getByLabel("Team name").filter({ visible: true }).fill(team);
    await org.getByTestId("add-team-workspace").click();
    await expect(org.getByTestId("teams-list")).toContainText(team);
  }
  await org.goto(seasonUrl);
  await org.getByTestId("advance-status").click();
  await expect(org.getByTestId("competition-status")).toHaveText("setup");
  await org.getByTestId("advance-status").click();
  await expect(org.getByTestId("competition-status")).toHaveText("registration open");

  // --- Registrations: import, approve most, leave a few to review ------------
  await org.getByTestId("open-dashboard").click();
  await expect(org.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 60_000,
  });
  const csv = [
    "name,phone,role,base_price_band",
    ...PLAYERS.map(([n, r, b], i) => `${n},9${STAMP}${String(i).padStart(2, "0")},${r},${b}`),
  ].join("\n");
  await org.getByTestId("open-import").click();
  await org.getByTestId("import-textarea").evaluate((el, value) => {
    (el as HTMLTextAreaElement).value = value;
  }, csv);
  await org.getByTestId("import-preview-btn").click();
  await expect(org.getByTestId("import-preview")).toContainText(`${PLAYERS.length} valid`, {
    timeout: 30_000,
  });
  await org.getByTestId("import-commit").click();
  await expect(org.getByTestId("stat-total")).toContainText(String(PLAYERS.length));
  await org.getByLabel("Select all on page").check();
  await org.getByTestId("bulk-approve").click();
  await expect(org.getByTestId("stat-approved")).toContainText(String(PLAYERS.length));
  await org.reload();
  await expect(org.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 60_000,
  });
  // The only change to a real screen: the local host in the share-link box
  // reads as the production domain.
  await org.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("input, code, span, p, div"))) {
      if (el.children.length === 0 && el.textContent?.includes("localhost:3070")) {
        el.textContent = el.textContent.replace("http://localhost:3070", "https://desiauction.in");
      }
      if (el instanceof HTMLInputElement && el.value.includes("localhost:3070")) {
        el.value = el.value.replace("http://localhost:3070", "https://desiauction.in");
      }
    }
  });
  await shot(org, "registrations-desk");

  await org.goto(`/seasons/${slug}`);
  await org.getByTestId("advance-status").click();
  await expect(org.getByTestId("competition-status")).toHaveText("registration closed");

  // --- Auction setup ----------------------------------------------------------
  await org.getByTestId("open-auction").click();
  await expect(org.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 60_000,
  });
  const shortSquads = org.getByTestId("accept-short-squads");
  if (await shortSquads.isVisible().catch(() => false)) await shortSquads.check();
  await org.getByLabel("Purse per team (₹)").fill("500000");
  await org.getByTestId("create-auction").click();
  await expect(org.getByTestId("auction-status")).toHaveText("scheduled", { timeout: 30_000 });

  await org.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(org.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 60_000,
  });
  const joinUrls: string[] = [];
  for (const team of TEAMS) {
    await org.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await org.getByTestId("invite-owner").click();
    await expect
      .poll(
        async () => {
          const url = (await org.getByTestId("owner-invite-url").textContent())?.trim() ?? "";
          return url.includes("/owner-join/") && !joinUrls.includes(url) ? url : "";
        },
        { timeout: 30_000 },
      )
      .not.toBe("");
    joinUrls.push(((await org.getByTestId("owner-invite-url").textContent()) ?? "").trim());
  }

  const OWNER_NAMES = ["Anil Verma", "Priya Sethi", "Karan Sharma", "Nisha Rao"];
  const owners: Page[] = [];
  for (let i = 0; i < TEAMS.length; i++) {
    const { page } = await newPage(browser, i === 0);
    await login(page, `85${STAMP}${i}`, OWNER_NAMES[i] as string);
    await page.goto(joinUrls[i] as string);
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 60_000,
    });
    owners.push(page);
  }

  await org.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(org.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 60_000,
  });
  for (const team of TEAMS) {
    await org
      .locator(".owner-row", { hasText: team })
      .getByRole("button", { name: "Grant paddle" })
      .click();
    await expect(
      org.locator(".owner-row", { hasText: team }).getByText("granted", { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
  }
  for (let i = 0; i < TEAMS.length; i++) {
    const page = owners[i] as Page;
    await page.goto(`/seasons/${slug}/auction/live`);
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 60_000,
    });
    await page.getByLabel("Team", { exact: true }).selectOption({ label: TEAMS[i] as string });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible({ timeout: 30_000 });
  }

  await org.goto(`/seasons/${slug}/auction`);
  await expect(org.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 60_000,
  });
  const queueAll = org.getByTestId("queue-all");
  if (!(await queueAll.isVisible().catch(() => false))) {
    const tab = org
      .getByRole("tablist", { name: "Auction sections" })
      .getByRole("tab", { name: /^Setup/ });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    await org.getByTestId("setup-step-open-lots").click();
  }
  await org.getByTestId("queue-all").first().click();
  await expect(org.getByTestId("lot-L001").first()).toContainText("queued");
  const shortOpen = org.getByTestId("accept-short-open");
  if (await shortOpen.isVisible().catch(() => false)) await shortOpen.check();
  await org.getByTestId("auction-open").click();
  await expect(org.getByTestId("auction-status")).toHaveText("live", { timeout: 30_000 });
  await org.getByTestId("open-live").click();
  await expect(org.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 60_000,
  });
  await expect(org.getByTestId("connection-state")).toHaveText("open", { timeout: 30_000 });

  // Big screen: the public board, full HD.
  const boardCtx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    baseURL: BASE,
  });
  await boardCtx.addInitScript((css) => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
    });
  }, HIDE_DEV);
  await boardCtx.addCookies(await org.context().cookies());
  const board = await boardCtx.newPage();
  const stageCtx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    baseURL: BASE,
  });
  await stageCtx.addCookies(await org.context().cookies());
  const stage = await stageCtx.newPage();

  // --- Lots ------------------------------------------------------------------
  // Lot order is shuffled, so the featured player's lot is found, not assumed.
  // Their lot gets the bidding war (Falcons, the phone we screenshot, win it at
  // the highest price of the night); every other lot is a short contest.
  const FIGHT = [1, 0, 2, 0, 3, 0, 1, 0];
  // The last bidder wins; the winners rotate so every team ends up with a squad.
  // The last bidder wins: Voyagers, Titans, Strikers, Falcons, then around again.
  const SHORT = [
    [3, 1],
    [1, 2],
    [2, 3],
    [1, 0],
  ];
  let sold = 0;
  let featuredDone = false;
  for (let lot = 0; lot < PLAYERS.length && (sold < 5 || !featuredDone); lot++) {
    await org.getByTestId("conduct-open-lot").click();
    for (const p of [org, ...owners]) {
      await expect(p.getByTestId("current-lot")).toBeVisible({ timeout: 30_000 });
    }
    const featured = ((await org.getByTestId("current-lot").textContent()) ?? "").includes(
      FEATURED,
    );
    const plan = featured ? FIGHT : (SHORT[sold % SHORT.length] as number[]);
    for (let b = 0; b < plan.length; b++) {
      const team = plan[b] as number;
      await (owners[team] as Page).getByTestId("bid-next").click();
      await expect(org.getByTestId("leading-team")).toContainText(TEAMS[team] as string, {
        timeout: 30_000,
      });
      if (featured && b === plan.length - 2) {
        // Mid-fight with a rival leading: the phone shows the raise button.
        await board.goto(`/seasons/${slug}/auction/board`);
        await stage.goto(`/seasons/${slug}/auction/spectate`);
        // Outbid toasts stack over the paddle; clear them so the raise shows.
        const dismiss = (owners[0] as Page).getByRole("button", { name: /^Dismiss:/ });
        while ((await dismiss.count()) > 0) await dismiss.first().click();
        await shot(owners[0] as Page, "owner-paddle-live");
        await shot(stage, "stage-live");
        await shot(org, "organizer-live");
      }
    }
    await holdClose(org);
    await expect(org.getByTestId("ceremony")).toBeVisible({ timeout: 30_000 });
    if (featured) {
      await shot(owners[0] as Page, "owner-paddle-sold");
      featuredDone = true;
    }
    if (plan.length > 0) sold++;
    console.log("lot", lot + 1, featured ? "FEATURED" : "", plan.length > 0 ? "sold" : "passed");
    await org.waitForTimeout(1500);
  }

  // Board after five sales.
  await board.goto(`/seasons/${slug}/auction/board`);
  await board.waitForTimeout(2500);
  await shot(board, "board");
  await shot(owners[0] as Page, "owner-paddle-after");
  console.log("done", slug);
} finally {
  await browser.close();
}
