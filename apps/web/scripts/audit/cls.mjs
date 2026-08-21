/**
 * WHICH ELEMENTS ARE MOVING, AND WHEN.
 *
 * The vitals run reported CLS failing on seven routes, worst 0.751 on the
 * projector board. A number is not a finding — `LayoutShift.sources` names the
 * nodes that actually moved and by how much, so this asks the browser to point.
 *
 * It also splits the score in two, because the two halves have different causes
 * and different fixes:
 *
 *   LOAD    — everything before any interaction. Skeleton-to-data swaps, images
 *             without reserved space, fonts, late-arriving snapshots.
 *   AFTER   — everything once the page has been scrolled or clicked. Reveals,
 *             lazy content, sticky chrome resizing.
 *
 * The earlier run measured them together, which is honest for a field score but
 * useless for a repair.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const ROUTES = process.env.AUDIT_ONLY
  ? [{ path: process.env.AUDIT_ONLY, auth: true }]
  : [
      { path: "/seasons/demo-premier-league/auction/board", auth: true },
      { path: "/seasons/demo-premier-league/auction/live", auth: true },
      { path: "/seasons/demo-premier-league", auth: true },
      { path: "/home", auth: true },
      { path: "/seasons/demo-cup-settled/money", auth: true },
      { path: "/admin/audit", auth: true },
      { path: "/org/demo-club/money", auth: true },
      { path: "/tournaments", auth: true },
    ];

const INIT = `
  window.__cls = { load: 0, after: 0, phase: "load", shifts: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls[window.__cls.phase] += e.value;
        for (const s of e.sources ?? []) {
          const n = s.node;
          if (!n || !n.getBoundingClientRect) continue;
          window.__cls.shifts.push({
            phase: window.__cls.phase,
            value: Math.round(e.value * 1000) / 1000,
            at: Math.round(e.startTime),
            tag: (n.tagName || "?").toLowerCase(),
            cls: (typeof n.className === "string" ? n.className : "").trim().slice(0, 52),
            id: n.id || null,
            testid: n.getAttribute ? n.getAttribute("data-testid") : null,
            movedY: Math.round((s.currentRect?.top ?? 0) - (s.previousRect?.top ?? 0)),
            movedX: Math.round((s.currentRect?.left ?? 0) - (s.previousRect?.left ?? 0)),
            text: (n.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40),
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
`;

const browser = await chromium.launch();
const report = [];
for (const r of ROUTES) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(r.auth ? { storageState: `${OUT}/${process.env.AUDIT_STATE ?? "state"}.json` } : {}),
  });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.goto(BASE + r.path, { waitUntil: "load", timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(3000); // live surfaces settle their first snapshot here
  await page.evaluate(() => (window.__cls.phase = "after"));
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(1500);

  const c = await page.evaluate(() => window.__cls);
  // One row per culprit, biggest mover first.
  const byNode = new Map();
  for (const s of c.shifts) {
    const k = `${s.phase}|${s.tag}.${s.cls}|${s.testid ?? ""}`;
    const prev = byNode.get(k);
    if (!prev || Math.abs(s.movedY) > Math.abs(prev.movedY)) byNode.set(k, s);
    if (prev) prev.n = (prev.n ?? 1) + 1;
  }
  const culprits = [...byNode.values()].sort((a, b) => Math.abs(b.movedY) - Math.abs(a.movedY));

  console.log(
    `\n${r.path}\n  CLS ${Math.round((c.load + c.after) * 1000) / 1000}  =  load ${Math.round(c.load * 1000) / 1000}  +  after-interaction ${Math.round(c.after * 1000) / 1000}`,
  );
  for (const s of culprits.slice(0, 5)) {
    console.log(
      `    [${s.phase}] +${String(s.value).padEnd(6)} @${String(s.at).padStart(5)}ms  moved ${String(s.movedY).padStart(5)}px  <${s.tag}${s.testid ? ` data-testid="${s.testid}"` : ""} class="${s.cls}">  ${JSON.stringify(s.text)}`,
    );
  }
  report.push({ path: r.path, load: c.load, after: c.after, culprits: culprits.slice(0, 8) });
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/cls.json`, JSON.stringify(report, null, 2));
console.log("\n-> cls.json");
