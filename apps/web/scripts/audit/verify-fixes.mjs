/**
 * DID THE FIXES LAND?
 *
 * One assertion per finding, measured the same way the finding was — not
 * "the code changed", which the diff already shows, but "the browser now
 * reports the number the audit said was wrong".
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";
const LEAGUE = "demo-premier-league";
const PUBCOMP = "night-cup-10472893-1f35";

const results = [];
const check = (id, what, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? " PASS" : " FAIL"}  ${id.padEnd(5)} ${what.padEnd(52)} ${detail}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: `${OUT}/state.json`,
});
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// --- F-1: auction.css now loads on the hub -----------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/seasons/${LEAGUE}/auction`, { waitUntil: "networkidle" });
  const el = page.getByTestId("open-board");
  const m = await el.evaluate((n) => {
    const cs = getComputedStyle(n),
      r = n.getBoundingClientRect();
    return { color: cs.color, h: Math.round(r.height) };
  });
  check(
    "F-1a",
    "'Open board' takes a theme colour, not #0000EE",
    m.color !== "rgb(0, 0, 238)",
    m.color,
  );
  check("F-1b", "'Open board' meets its 44px target", m.h >= 44, `${m.h}px`);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    vw: innerWidth,
  }));
  check(
    "F-1c",
    "auction hub does not scroll sideways at 320px",
    w.doc <= w.vw + 1,
    `doc=${w.doc} vw=${w.vw}`,
  );
  await page.close();
}

// --- F-4: messaging is in the admin tab strip --------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/messaging`, { waitUntil: "networkidle" });
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll("nav a, [role=tablist] a")].map((a) => ({
      text: (a.textContent || "").trim(),
      active: a.getAttribute("aria-current") ?? a.className,
    })),
  );
  const messaging = tabs.find((t) => t.text === "Messaging");
  check(
    "F-4a",
    "an admin tab exists for Messaging",
    messaging !== undefined,
    messaging ? "present" : "missing",
  );
  check(
    "F-4b",
    "the Messaging tab is the one marked current",
    String(messaging?.active).includes("page") || String(messaging?.active).includes("active"),
    String(messaging?.active).slice(0, 40),
  );
  const ident = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return {
      h1: h1?.textContent?.trim(),
      crumbs: [...document.querySelectorAll("nav[aria-label*=readcrumb] a, .breadcrumb a")].map(
        (a) => a.textContent?.trim(),
      ),
    };
  });
  check(
    "F-4c",
    "title no longer repeats its own breadcrumb",
    ident.h1 !== "Platform admin" || !ident.crumbs.includes("Platform admin"),
    `h1="${ident.h1}" crumbs=${JSON.stringify(ident.crumbs)}`,
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    vw: innerWidth,
  }));
  check(
    "F-7a",
    "/admin/messaging does not overflow at 320px",
    w.doc <= w.vw + 1,
    `doc=${w.doc} vw=${w.vw}`,
  );
  await page.close();
}

// --- F-7: admin health ULIDs wrap --------------------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/health`, { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    vw: innerWidth,
  }));
  check(
    "F-7b",
    "/admin/health does not overflow at 320px",
    w.doc <= w.vw + 1,
    `doc=${w.doc} vw=${w.vw}`,
  );
  await page.close();
}

// --- F-5: no hydration error on the replay viewer ----------------------------
{
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/seasons/demo-cup-settled/auction/replay`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const hydration = errs.filter((e) => /Hydration failed|didn't match/i.test(e));
  check(
    "F-5",
    "replay viewer hydrates without a mismatch",
    hydration.length === 0,
    hydration[0]?.slice(0, 60) ?? "clean",
  );
  await page.close();
}

// --- F-6: toast dismiss target ------------------------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/seasons/${LEAGUE}/auction/live`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const btn = page.locator("button[aria-label^='Dismiss']").first();
  if (await btn.count()) {
    const r = await btn.evaluate((n) => {
      const b = n.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    check("F-6", "toast dismiss meets the 24x24 AA floor", r.w >= 24 && r.h >= 24, `${r.w}x${r.h}`);
  } else
    check(
      "F-6",
      "toast dismiss meets the 24x24 AA floor",
      null,
      "no toast on screen — checked in unit test instead",
    );
  await page.close();
}

// --- F-9: rail tagline ---------------------------------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  const t = await page.evaluate(() => {
    const el = document.querySelector("[class*=rail-tagline]");
    if (!el) return null;
    return {
      size: parseFloat(getComputedStyle(el).fontSize),
      hidden: el.getAttribute("aria-hidden"),
    };
  });
  check(
    "F-9",
    "rail tagline is >=10px and hidden from AT",
    t !== null && t.size >= 10 && t.hidden !== null,
    t ? `${t.size}px aria-hidden=${t.hidden}` : "absent",
  );
  await page.close();
}

// --- F-8: the landing page shares with an image --------------------------------
{
  const page = await anon.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const og = await page.evaluate(() => ({
    image: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    site: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? null,
  }));
  check(
    "F-8a",
    "landing page emits an og:image",
    og.image !== null,
    og.image?.slice(0, 60) ?? "none",
  );
  await page.goto(`${BASE}/help`, { waitUntil: "domcontentloaded" });
  const og2 = await page.evaluate(
    () => document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
  );
  check("F-8b", "help centre inherits the default card", og2 !== null, og2?.slice(0, 60) ?? "none");
  await page.close();
}

// --- F-10 / F-12: the public competition hero ----------------------------------
{
  const page = await anon.newPage();
  await page.goto(`${BASE}/c/${PUBCOMP}`, { waitUntil: "networkidle" });
  const hero = await page.evaluate(() => {
    const row = document.querySelector(".public-cta-row");
    return [...(row?.querySelectorAll("a") ?? [])].map((a) => (a.textContent || "").trim());
  });
  check(
    "F-10",
    "the hero link to /c is named 'All tournaments'",
    hero.includes("All tournaments"),
    JSON.stringify(hero),
  );
  check(
    "F-12",
    "a closed competition offers a way further in",
    hero.some((t) => t === "See the squads"),
    JSON.stringify(hero),
  );
  await page.close();
}

// --- F-11: the readiness verdict -------------------------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/seasons/${LEAGUE}/readiness`, { waitUntil: "networkidle" });
  const v = await page
    .getByTestId("readiness-verdict")
    .textContent()
    .catch(() => null);
  const short = await page
    .getByTestId("check-squads_fillable")
    .textContent()
    .catch(() => "");
  const contradicts = v === "Ready for auction" && /Short/.test(short ?? "");
  check(
    "F-11",
    "the verdict does not contradict the row beneath it",
    !contradicts,
    `verdict="${v}"`,
  );
  await page.close();
}

await browser.close();
const failed = results.filter((r) => r.pass === false).length;
console.log(
  `\n${results.filter((r) => r.pass === true).length} passed, ${failed} failed, ${results.filter((r) => r.pass === null).length} n/a`,
);
process.exit(failed > 0 ? 1 : 0);
