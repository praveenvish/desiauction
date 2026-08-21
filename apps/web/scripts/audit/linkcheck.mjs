/**
 * THE UNSTYLED-LINK SWEEP.
 *
 * `base.css` repairs bare anchors, but the repair is scoped `a:not([class])`.
 * Any anchor given a class for LAYOUT alone — no colour — therefore keeps the
 * user agent's `#0000EE`, which on the floodlit console surface is 1.92:1.
 * The codebase has found this exact bug twice before (base.css's own header,
 * money.css:235); this asks how many are left, product-wide, in both themes.
 */
import { chromium } from "@playwright/test";
import { ROUTES } from "./routes.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

// The UA defaults, in every form a browser reports them.
const UA_LINK = new Set(["rgb(0, 0, 238)", "rgb(0, 0, 255)", "rgb(85, 26, 139)", "rgb(0, 0, 204)"]);

const PROBE = `(() => {
  const hits = [];
  for (const a of document.querySelectorAll("a[href], button")) {
    const r = a.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const c = getComputedStyle(a).color;
    if (!${JSON.stringify([...UA_LINK])}.includes(c)) continue;
    hits.push({
      color: c,
      cls: (typeof a.className === "string" ? a.className : "").trim().slice(0, 60),
      text: (a.textContent || "").trim().slice(0, 40),
      href: a.getAttribute("href"),
    });
  }
  const seen = new Set();
  return hits.filter((h) => { const k = h.cls + h.text; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

const browser = await chromium.launch();
const found = new Map();
for (const theme of ["daylight", "floodlight"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: `${OUT}/state.json`,
  });
  await ctx.addInitScript(`try{localStorage.setItem("da-theme",${JSON.stringify(theme)})}catch{}`);
  for (const r of ROUTES) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + r.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      for (const h of await page.evaluate(PROBE)) {
        const k = `${h.cls}|${h.text}`;
        if (!found.has(k)) found.set(k, { ...h, themes: new Set(), routes: [] });
        const e = found.get(k);
        e.themes.add(theme);
        if (e.routes.length < 3) e.routes.push(r.path);
      }
    } catch {}
    await page.close();
  }
  await ctx.close();
}
await browser.close();
if (found.size === 0) console.log("no unstyled anchors found");
for (const e of found.values()) {
  console.log(
    `${e.color}  class="${e.cls}"  "${e.text}"  themes=${[...e.themes].join("+")}  e.g. ${e.routes[0]}`,
  );
}
