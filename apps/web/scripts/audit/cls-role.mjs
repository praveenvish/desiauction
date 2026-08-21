/**
 * THE SAME SCREEN, TWO ROLES.
 *
 * The live room's residual shift is dominated by a paddle list and a conduct
 * panel — both of which only a CONDUCTOR sees. Measuring only as the founder
 * (who holds every capability) therefore reports the worst case as if it were
 * the common one. This measures the same route for a conductor and for an
 * ordinary bidder, which is who actually sits in that room.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const INIT = `window.__c = 0;
  try { new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__c += e.value;
  }).observe({ type: "layout-shift", buffered: true }); } catch {}`;

const ROUTES = [
  "/seasons/demo-premier-league/auction/live",
  "/seasons/demo-premier-league/auction/board",
  "/seasons/demo-premier-league/auction/spectate",
];

const browser = await chromium.launch();
for (const [role, state] of [
  ["conductor (founder)", "state"],
  ["bidder", "state-bidder"],
]) {
  for (const path of ROUTES) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: `${OUT}/${state}.json`,
    });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(BASE + path, { waitUntil: "load", timeout: 90_000 });
    await page.waitForTimeout(3500);
    const cls = await page.evaluate(() => Math.round(window.__c * 1000) / 1000);
    const conduct = await page.locator('[data-testid="conduct-panel"]').count();
    const band = cls <= 0.1 ? "good" : cls <= 0.25 ? "needs work" : "POOR";
    console.log(
      `  ${role.padEnd(20)} CLS ${String(cls).padStart(6)}  ${band.padEnd(11)} conductPanel=${conduct}  ${path.replace("/seasons/demo-premier-league/auction", "")}`,
    );
    await ctx.close();
  }
}
await browser.close();
