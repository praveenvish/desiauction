/**
 * Does the console top bar still move when the page action arrives?
 *
 * `PageAction` publishes from a useEffect, so the action is absent at first
 * paint and present after hydration. This measures the bar's height in both
 * states, and the resulting layout shift, at the width where the action used to
 * claim a row of its own.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const INIT = `window.__cls = 0;
  try { new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: "layout-shift", buffered: true }); } catch {}`;

const browser = await chromium.launch();
for (const path of ["/home", "/tournaments", "/seasons/demo-premier-league/teams"]) {
  for (const width of [320, 390, 430, 719, 768]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      storageState: `${OUT}/state.json`,
    });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    // JS off: exactly what the server sent, before any action is published.
    const noJs = await browser.newContext({
      viewport: { width, height: 844 },
      storageState: `${OUT}/state.json`,
      javaScriptEnabled: false,
    });
    const bare = await noJs.newPage();
    await bare.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const serverH = await bare
      .locator("header")
      .first()
      .evaluate((n) => Math.round(n.getBoundingClientRect().height));
    await noJs.close();

    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(1200);
    const hydratedH = await page
      .locator("header")
      .first()
      .evaluate((n) => Math.round(n.getBoundingClientRect().height));
    const cls = await page.evaluate(() => Math.round(window.__cls * 1000) / 1000);
    const rows = await page.evaluate(() => {
      const inner = document.querySelector('[class*="topbar-inner"]');
      if (!inner) return null;
      const tops = new Set(
        [...inner.children].map((c) => Math.round(c.getBoundingClientRect().top)),
      );
      return tops.size;
    });
    // The metric is not the point on its own — the first attempt at this fix
    // reached CLS 0 by squeezing the page title off the screen. So the title's
    // rendered width is measured alongside the shift.
    const titleW = await page
      .locator("h1")
      .first()
      .evaluate((n) => Math.round(n.getBoundingClientRect().width))
      .catch(() => -1);
    const delta = hydratedH - serverH;
    console.log(
      `  ${String(width).padStart(4)}px  header ${String(serverH).padStart(3)}→${String(hydratedH).padStart(3)}px (d${String(delta).padStart(4)})  rows=${rows}  title=${String(titleW).padStart(4)}px  CLS ${String(cls).padStart(6)}  ${path}`,
    );
    await ctx.close();
  }
  console.log("");
}
await browser.close();
