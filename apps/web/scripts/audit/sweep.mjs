/**
 * THE PRODUCT SWEEP.
 *
 * One pass over every route in the product, at every target width, recording
 * the things a human reviewer cannot hold in their head across 79 screens:
 * horizontal overflow, undersized touch targets, axe violations, console
 * errors, heading structure, and the document metadata search engines read.
 *
 * It loads each route ONCE and then resizes. CSS media queries and layout
 * re-evaluate on resize, so a reload per width would cost 12x for the same
 * answer — the exception is anything rendered from a server-side width
 * decision, and this product has none (verified: no UA sniffing in src).
 *
 * Output is JSON, not prose. The reading happens afterwards.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ROUTES, WIDTHS, SHOT_WIDTHS } from "./routes.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";
const AXE = readFileSync(
  "../../node_modules/.pnpm/axe-core@4.12.1/node_modules/axe-core/axe.min.js",
  "utf8",
);
const SHOTS = process.env.AUDIT_SHOTS === "1";
const ONLY = process.env.AUDIT_ONLY;

mkdirSync(`${OUT}/shots`, { recursive: true });

/** Measured inside the page: everything that depends on the current width. */
const MEASURE = `(() => {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const overflowing = [];
  // Only report the OUTERMOST offenders. A wide table makes every ancestor
  // wide too, and listing all of them buries the one element to fix.
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed") continue;      // fixed chrome is placed on purpose
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    let p = el.parentElement, nested = false;
    while (p) { if (seen.has(p)) { nested = true; break; } p = p.parentElement; }
    if (nested) continue;
    seen.add(el);
    overflowing.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 90),
      id: el.id || null,
      right: Math.round(r.right), left: Math.round(r.left), width: Math.round(r.width),
      text: (el.textContent || "").trim().slice(0, 60),
      scrolls: el.scrollWidth > el.clientWidth + 1 && ["auto","scroll"].includes(cs.overflowX),
    });
  }
  // Touch targets. 44x44 is the WCAG 2.2 AAA / Apple HIG floor; 24x24 is the
  // AA (2.5.8) floor. Both are reported so severity can be judged later.
  const small = [];
  const INTERACTIVE = "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=link],[role=switch],[role=checkbox],summary";
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    if (r.width >= 44 && r.height >= 44) continue;
    small.push({
      tag: el.tagName.toLowerCase(),
      w: Math.round(r.width), h: Math.round(r.height),
      label: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().slice(0, 40),
      belowAA: r.width < 24 || r.height < 24,
    });
  }
  return {
    vw,
    scrollWidth: doc.scrollWidth,
    hOverflow: doc.scrollWidth > vw + 1,
    overflowing: overflowing.slice(0, 12),
    smallTargets: small.slice(0, 25),
    smallTargetCount: small.length,
    belowAACount: small.filter((t) => t.belowAA).length,
  };
})()`;

/** Measured once per route: structure and metadata, width-independent. */
const STRUCTURE = `(() => {
  const q = (s) => document.querySelector(s);
  const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({
    level: Number(h.tagName[1]),
    text: (h.textContent || "").trim().slice(0, 70),
  }));
  const skips = [];
  let prev = 0;
  for (const h of heads) {
    if (prev !== 0 && h.level > prev + 1) skips.push({ from: prev, to: h.level, text: h.text });
    prev = h.level;
  }
  const tinyText = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || "").trim();
    if (t.length < 2) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size > 0 && size < 12) tinyText.push({ size, text: t.slice(0, 40) });
  }
  return {
    title: document.title,
    lang: document.documentElement.lang || null,
    theme: document.documentElement.getAttribute("data-theme"),
    description: q('meta[name="description"]')?.content ?? null,
    canonical: q('link[rel="canonical"]')?.href ?? null,
    ogTitle: q('meta[property="og:title"]')?.content ?? null,
    ogImage: q('meta[property="og:image"]')?.content ?? null,
    robots: q('meta[name="robots"]')?.content ?? null,
    h1Count: heads.filter((h) => h.level === 1).length,
    h1: heads.filter((h) => h.level === 1).map((h) => h.text),
    headingSkips: skips,
    headingCount: heads.length,
    tinyText: tinyText.slice(0, 8),
    mainCount: document.querySelectorAll("main").length,
    skipLink: !!document.querySelector('a[href^="#"]:first-of-type'),
    imgNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    forms: document.querySelectorAll("form").length,
    dialogs: document.querySelectorAll("dialog").length,
  };
})()`;

async function run() {
  const browser = await chromium.launch();
  const results = [];
  const routes = ONLY ? ROUTES.filter((r) => r.path.includes(ONLY)) : ROUTES;

  for (const authed of [false, true]) {
    const list = routes.filter((r) => (authed ? true : !r.auth));
    if (list.length === 0) continue;
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      ...(authed ? { storageState: `${OUT}/state.json` } : {}),
    });
    for (const route of list) {
      const key = `${authed ? "auth" : "anon"}${route.path.replace(/[^a-z0-9]/gi, "_").slice(0, 70)}`;
      const page = await ctx.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") {
          consoleErrors.push(`${m.type()}: ${m.text().slice(0, 220)}`);
        }
      });
      page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 220)));

      const record = { path: route.path, area: route.area, authed, key };
      try {
        const t0 = Date.now();
        const resp = await page.goto(BASE + route.path, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        record.status = resp?.status() ?? null;
        record.finalUrl = page.url().replace(BASE, "");
        record.redirected = record.finalUrl !== route.path;
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        record.loadMs = Date.now() - t0;

        record.structure = await page.evaluate(STRUCTURE);
        record.widths = {};
        for (const w of WIDTHS) {
          await page.setViewportSize({ width: w, height: w < 700 ? 844 : 900 });
          await page.waitForTimeout(90);
          record.widths[w] = await page.evaluate(MEASURE);
          if (SHOTS && SHOT_WIDTHS.includes(w)) {
            await page
              .screenshot({ path: `${OUT}/shots/${key}__${w}.png`, fullPage: false })
              .catch(() => {});
          }
        }

        // axe at a mobile and a desktop width — violations differ with layout.
        record.axe = {};
        for (const w of [390, 1440]) {
          await page.setViewportSize({ width: w, height: w < 700 ? 844 : 900 });
          await page.waitForTimeout(120);
          await page.addScriptTag({ content: AXE });
          const res = await page.evaluate(async () => {
            const r = await window.axe.run(document, {
              resultTypes: ["violations"],
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
              },
            });
            return r.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              help: v.help,
              n: v.nodes.length,
              nodes: v.nodes.slice(0, 3).map((n) => ({
                target: n.target.join(" "),
                summary: (n.failureSummary || "").replace(/\s+/g, " ").slice(0, 200),
              })),
            }));
          });
          record.axe[w] = res;
        }
      } catch (err) {
        record.error = String(err).slice(0, 300);
      }
      record.consoleErrors = [...new Set(consoleErrors)].slice(0, 10);
      record.pageErrors = [...new Set(pageErrors)].slice(0, 6);
      results.push(record);
      const bad =
        (record.error ? "ERR " : "") +
        (record.status && record.status >= 400 ? `${record.status} ` : "") +
        (Object.values(record.widths ?? {}).some((w) => w.hOverflow) ? "OVERFLOW " : "") +
        (Object.values(record.axe ?? {}).some((v) => v.length > 0) ? "AXE " : "") +
        (record.pageErrors.length ? "JSERR " : "");
      console.log(
        `${authed ? "A" : "-"} ${String(record.status ?? "---").padEnd(3)} ${String(record.loadMs ?? "").padStart(5)}ms  ${route.path.padEnd(58)} ${bad}`,
      );
      await page.close();
    }
    await ctx.close();
  }

  await browser.close();
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${results.length} records to ${OUT}/results.json`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
