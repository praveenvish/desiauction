/**
 * THE OTHER ENGINES.
 *
 * Everything above was measured in Chromium. The three things this product
 * leans on hardest — `position: sticky` chrome, `color-mix()` in almost every
 * colour, and `backdrop-filter` on overlays — are exactly where WebKit and
 * Gecko have historically differed, and a design system that resolves to a
 * different colour in Safari is not one design system.
 *
 * For each engine this records: the composited colour of the accent and the
 * body surface (so a `color-mix()` that failed to parse shows up as a
 * different value, not as a subtle wrongness nobody notices), whether sticky
 * elements actually stuck after a scroll, document overflow, and any console
 * error the engine raised that Chromium did not.
 */
import { chromium, webkit, firefox } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const ROUTES = [
  { path: "/", auth: false },
  { path: "/pricing", auth: false },
  { path: "/c", auth: false },
  { path: "/login", auth: false },
  { path: "/home", auth: true },
  { path: "/seasons/demo-premier-league", auth: true },
  { path: "/seasons/demo-premier-league/registrations", auth: true },
  { path: "/seasons/demo-premier-league/auction/live", auth: true },
  { path: "/seasons/demo-premier-league/auction/board", auth: true },
  { path: "/admin", auth: true },
];

const PROBE = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const stuck = [];
  for (const el of document.querySelectorAll("body *")) {
    if (getComputedStyle(el).position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    stuck.push({ cls: (typeof el.className === "string" ? el.className : "").slice(0, 40), top: Math.round(r.top) });
    if (stuck.length > 6) break;
  }
  // A color-mix() the engine cannot parse leaves the property at its initial
  // value, so reading the RESOLVED colour is what distinguishes support from
  // silent fallback.
  const probe = document.createElement("div");
  probe.style.color = "color-mix(in srgb, #ff0000 50%, #0000ff)";
  document.body.appendChild(probe);
  const mixed = getComputedStyle(probe).color;
  probe.remove();
  return {
    accent: cs.getPropertyValue("--accent").trim(),
    bodyBg: body.backgroundColor,
    bodyColor: body.color,
    fontFamily: body.fontFamily.split(",")[0],
    colorMix: mixed,
    supportsColorMix: CSS.supports("color", "color-mix(in srgb, red 50%, blue)"),
    supportsBackdrop: CSS.supports("backdrop-filter", "blur(4px)") || CSS.supports("-webkit-backdrop-filter", "blur(4px)"),
    supportsHas: CSS.supports("selector(:has(a))"),
    stickyCount: stuck.length,
    sticky: stuck,
    docWidth: document.documentElement.scrollWidth,
    vw: innerWidth,
  };
})()`;

const report = [];
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
  ["firefox", firefox],
]) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    console.log(`${name}: NOT INSTALLED — ${String(e).slice(0, 90)}`);
    continue;
  }
  for (const r of ROUTES) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      ...(r.auth ? { storageState: `${OUT}/state.json` } : {}),
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 140));
    });
    const row = { engine: name, path: r.path };
    try {
      await page.goto(BASE + r.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(250);
      Object.assign(row, await page.evaluate(PROBE));
    } catch (e) {
      row.error = String(e).slice(0, 140);
    }
    row.errors = [...new Set(errors)].slice(0, 4);
    report.push(row);
    await ctx.close();
  }
  await browser.close();
  console.log(`${name}: ${ROUTES.length} routes`);
}
writeFileSync(`${OUT}/browsers.json`, JSON.stringify(report, null, 2));

// The comparison is the point, so it is printed rather than left in the file.
const byPath = {};
for (const row of report) (byPath[row.path] ??= []).push(row);
for (const [path, rows] of Object.entries(byPath)) {
  const keys = [
    "accent",
    "bodyBg",
    "colorMix",
    "supportsColorMix",
    "supportsBackdrop",
    "supportsHas",
    "stickyCount",
    "docWidth",
  ];
  const diffs = keys.filter((k) => new Set(rows.map((r) => JSON.stringify(r[k]))).size > 1);
  const errs = rows.filter((r) => r.errors?.length || r.error);
  if (diffs.length || errs.length) {
    console.log(`\n${path}`);
    for (const k of diffs)
      console.log(`   ${k}: ` + rows.map((r) => `${r.engine}=${JSON.stringify(r[k])}`).join("  "));
    for (const e of errs)
      console.log(`   ${e.engine} errors: ${JSON.stringify(e.error ?? e.errors)}`);
  }
}
console.log("\n-> browsers.json");
