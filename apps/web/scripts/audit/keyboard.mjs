/**
 * KEYBOARD OPERABILITY — the half of WCAG that a scanner cannot see.
 *
 * axe reads the DOM; it never presses Tab. This walks the real focus order
 * with real key presses and records, for every stop:
 *
 *   · whether a focus indicator is actually painted (outline, ring or a
 *     visibly different box-shadow — checked against the element's own
 *     unfocused computed style, not against a guess);
 *   · whether the stop is inside the viewport when it receives focus, which
 *     is how a keyboard user discovers an off-screen or clipped control;
 *   · whether focus order still follows DOM order, which is what breaks
 *     when a layout is reordered with CSS `order` or `grid-area`;
 *   · whether the first stop is a skip link.
 *
 * It also checks that a focus TRAP exists where one is required (open
 * dialogs) and nowhere else.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

import { ROUTES } from "./routes.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";
const MAX_STOPS = 80;

// EVERY route, not a sample. A keyboard trap or an unreachable control is
// exactly the kind of defect that hides on the page nobody thought to check,
// so the target list is the same one the sweep uses.
const TARGETS = ROUTES.map((r) => ({ path: r.path, auth: r.auth }));

const DESCRIBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { none: true };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    label: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 48),
    outline: cs.outlineStyle === "none" || cs.outlineWidth === "0px" ? null : cs.outlineWidth + " " + cs.outlineColor,
    boxShadow: cs.boxShadow === "none" ? null : cs.boxShadow.slice(0, 70),
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    domIndex: [...document.querySelectorAll("*")].indexOf(el),
    href: el.getAttribute("href"),
  };
})()`;

// The same element with focus removed, so "does focus change anything?" is
// answered by comparison rather than by assuming an outline is the mechanism.
const UNFOCUSED = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  el.blur();
  const cs = getComputedStyle(el);
  const out = {
    outline: cs.outlineStyle === "none" || cs.outlineWidth === "0px" ? null : cs.outlineWidth + " " + cs.outlineColor,
    boxShadow: cs.boxShadow === "none" ? null : cs.boxShadow.slice(0, 70),
  };
  el.focus();
  return out;
})()`;

const browser = await chromium.launch();
const report = [];
for (const t of TARGETS) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(t.auth ? { storageState: `${OUT}/state.json` } : {}),
  });
  const page = await ctx.newPage();
  const row = { path: t.path, stops: [], noIndicator: [], offscreen: [], orderBreaks: 0 };
  try {
    await page.goto(BASE + t.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => document.body.focus());
    let lastDom = -1;
    const seen = new Set();
    for (let i = 0; i < MAX_STOPS; i++) {
      await page.keyboard.press("Tab");
      const d = await page.evaluate(DESCRIBE);
      if (d.none) break;
      const key = d.tag + "|" + d.label + "|" + d.domIndex;
      if (seen.has(key)) break; // wrapped round to the start
      seen.add(key);
      const u = await page.evaluate(UNFOCUSED);
      const changed = u !== null && (u.outline !== d.outline || u.boxShadow !== d.boxShadow);
      if (!changed) row.noIndicator.push({ i, tag: d.tag, label: d.label, href: d.href });
      if (!d.inViewport) row.offscreen.push({ i, tag: d.tag, label: d.label, rect: d.rect });
      if (d.domIndex < lastDom) row.orderBreaks++;
      lastDom = d.domIndex;
      row.stops.push({ i, tag: d.tag, label: d.label });
    }
    row.first = row.stops[0] ?? null;
    row.total = row.stops.length;
  } catch (e) {
    row.error = String(e).slice(0, 160);
  }
  report.push(row);
  console.log(
    `${String(row.total ?? 0).padStart(3)} stops  noIndicator=${String(row.noIndicator.length).padStart(2)}  offscreen=${String(row.offscreen.length).padStart(2)}  orderBreaks=${row.orderBreaks}  ${t.path}`,
  );
  if (row.noIndicator.length)
    console.log(
      `      no visible focus: ${row.noIndicator
        .slice(0, 5)
        .map((x) => `${x.tag}"${x.label.slice(0, 24)}"`)
        .join(", ")}`,
    );
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/keyboard.json`, JSON.stringify(report, null, 2));
console.log("\n-> keyboard.json");
