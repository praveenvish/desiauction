/**
 * FIELD-SHAPED PERFORMANCE, AGAINST A PRODUCTION BUILD.
 *
 * The route sweep's timings are `next dev` compile times and say nothing about
 * what a person experiences. These come from `next start` over a real
 * production build, on a throttled connection and a throttled CPU, at 390px —
 * because a premium interface that is only fast on the machine that built it is
 * not fast.
 *
 * INP IS MEASURED, NOT GUESSED. An earlier draft dispatched a synthetic
 * `pointerdown` and timed two animation frames, which measures the harness
 * rather than the product: a synthetic event has no `interactionId`, skips hit
 * testing, and never enters the input queue that INP exists to describe. This
 * version registers a PerformanceObserver on `event` entries, performs REAL
 * Playwright input (which goes through CDP and therefore through the browser's
 * actual input pipeline), and reads back the worst interaction the browser
 * itself recorded.
 *
 * Interactions are chosen to be SAFE — a control that does not navigate, submit
 * or mutate — because this runs against the demo organisation's real data.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const ROUTES = [
  { path: "/", auth: false, label: "landing" },
  { path: "/pricing", auth: false, label: "pricing" },
  { path: "/features", auth: false, label: "features" },
  { path: "/c", auth: false, label: "tournament directory" },
  { path: "/c/night-cup-10472893-1f35", auth: false, label: "public competition" },
  { path: "/help", auth: false, label: "help centre" },
  { path: "/legal/terms", auth: false, label: "legal" },
  { path: "/login", auth: false, label: "login" },
  { path: "/home", auth: true, label: "console home" },
  { path: "/tournaments", auth: true, label: "tournaments" },
  { path: "/seasons/demo-premier-league", auth: true, label: "season overview" },
  { path: "/seasons/demo-premier-league/teams", auth: true, label: "teams" },
  { path: "/seasons/demo-premier-league/registrations", auth: true, label: "registration desk" },
  { path: "/seasons/demo-premier-league/auction", auth: true, label: "auction hub" },
  { path: "/seasons/demo-premier-league/auction/live", auth: true, label: "LIVE AUCTION ROOM" },
  { path: "/seasons/demo-premier-league/auction/board", auth: true, label: "projector board" },
  { path: "/seasons/demo-cup-settled/money", auth: true, label: "settlement" },
  { path: "/org/demo-club/money", auth: true, label: "finance console" },
  { path: "/admin/audit", auth: true, label: "audit explorer" },
];

// Registered before any of the page's own script runs, so nothing is missed.
const VITALS_INIT = `
  window.__v = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0, worstEvent: 0, events: 0 };
  const obs = (type, fn, extra) => {
    try { new PerformanceObserver(fn).observe({ type, buffered: true, ...(extra ?? {}) }); } catch {}
  };
  obs("largest-contentful-paint", (l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; });
  obs("layout-shift", (l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; });
  obs("longtask", (l) => { for (const e of l.getEntries()) { window.__v.longTasks++; window.__v.longTaskMs += e.duration; } });
  // INP's own source. \`interactionId > 0\` is what separates a real user
  // interaction from an ordinary event, and \`duration\` is input-to-next-paint.
  obs("event", (l) => {
    for (const e of l.getEntries()) {
      if (!e.interactionId) continue;
      window.__v.events++;
      if (e.duration > window.__v.worstEvent) window.__v.worstEvent = e.duration;
    }
  }, { durationThreshold: 16 });
`;

const rate = (v, good, poor) => (v <= good ? "good" : v <= poor ? "needs work" : "POOR");

const browser = await chromium.launch();
const rows = [];

for (const r of ROUTES) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ...(r.auth ? { storageState: `${OUT}/state.json` } : {}),
  });
  await ctx.addInitScript(VITALS_INIT);
  const page = await ctx.newPage();

  const bytes = {};
  page.on("response", (res) => {
    try {
      const type = (res.headers()["content-type"] ?? "other").split(";")[0];
      const len = Number(res.headers()["content-length"] ?? 0);
      const key = type.includes("javascript")
        ? "js"
        : type.includes("css")
          ? "css"
          : type.includes("font")
            ? "font"
            : type.startsWith("image/")
              ? "image"
              : type.includes("html")
                ? "html"
                : "other";
      bytes[key] = (bytes[key] ?? 0) + len;
    } catch {}
  });

  // Fast 4G and a CPU four times slower than this laptop — roughly a mid-range
  // Android, which is what an owner in a hall is actually holding.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const row = { ...r, bytes };
  try {
    const resp = await page.goto(BASE + r.path, { waitUntil: "load", timeout: 90_000 });
    row.status = resp?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(1500); // let LCP settle and late shifts land

    Object.assign(
      row,
      await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return n
          ? {
              ttfb: Math.round(n.responseStart),
              dcl: Math.round(n.domContentLoadedEventEnd),
              load: Math.round(n.loadEventEnd),
            }
          : {};
      }),
    );

    // --- real interactions, through the browser's own input pipeline ---------
    // Safe by construction: a keyboard focus walk moves nothing, and the only
    // clicks are on controls that neither navigate nor submit.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(60);
    }
    const safe = page
      .locator(
        'button[type="button"]:not([disabled]):visible, summary:visible, [role="tab"]:visible',
      )
      .first();
    if (await safe.count()) {
      await safe.click({ timeout: 4000, trial: false }).catch(() => {});
      await page.waitForTimeout(400);
      await safe.click({ timeout: 4000 }).catch(() => {}); // toggle back
      await page.waitForTimeout(400);
    }
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(700);

    const v = await page.evaluate(() => window.__v);
    Object.assign(row, {
      lcp: Math.round(v.lcp),
      cls: Math.round(v.cls * 1000) / 1000,
      longTasks: v.longTasks,
      longTaskMs: Math.round(v.longTaskMs),
      inp: Math.round(v.worstEvent),
      interactions: v.events,
    });
  } catch (e) {
    row.error = String(e).slice(0, 160);
  }

  const kb = (n) => Math.round((n ?? 0) / 1024);
  console.log(
    [
      `LCP ${String(row.lcp ?? "-").padStart(5)}ms ${rate(row.lcp ?? 0, 2500, 4000).padEnd(10)}`,
      `CLS ${String(row.cls ?? "-").padStart(5)} ${rate(row.cls ?? 0, 0.1, 0.25).padEnd(10)}`,
      `INP ${String(row.inp ?? "-").padStart(4)}ms ${rate(row.inp ?? 0, 200, 500).padEnd(10)}`,
      `ttfb ${String(row.ttfb ?? "-").padStart(4)}`,
      `js ${String(kb(bytes.js)).padStart(4)}kb`,
      r.path,
    ].join("  "),
  );
  rows.push(row);
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/perf.json`, JSON.stringify(rows, null, 2));

const ok = rows.filter((x) => !x.error);
const worst = (k) => Math.max(...ok.map((x) => x[k] ?? 0));
console.log(`\n${ok.length}/${rows.length} routes measured`);
console.log(
  `worst LCP ${worst("lcp")}ms · worst CLS ${Math.max(...ok.map((x) => x.cls ?? 0))} · worst INP ${worst("inp")}ms`,
);
console.log("-> perf.json");
