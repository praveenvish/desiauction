/**
 * HOW TALL IS THE STAGE, PHASE BY PHASE?
 *
 * Giving `.ceremony` one height means picking a number, and a picked number is
 * only defensible if it came from measurement. This walks the surfaces that
 * render the stage, at every width the product supports, and records the height
 * of each phase it can reach — including the connecting phase, which is the one
 * every load starts in.
 *
 * The tallest phase is the floor: anything shorter and the stage grows when that
 * phase arrives, which is the shift this is meant to remove.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const WIDTHS = [320, 390, 430, 768, 1024, 1440, 1920];
const SURFACES = [
  { path: "/seasons/demo-premier-league/auction/live", label: "live (running)" },
  { path: "/seasons/demo-premier-league/auction/spectate", label: "spectate (running)" },
  { path: "/seasons/demo-cup-settled/auction/spectate", label: "spectate (settled)" },
];

const READ = `(() => {
  const el = document.querySelector('[data-testid="ceremony"]');
  if (el === null) return null;
  return {
    phase: el.dataset.phase ?? "?",
    h: Math.round(el.getBoundingClientRect().height),
    text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40),
  };
})()`;

const browser = await chromium.launch();
const rows = [];
for (const s of SURFACES) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      storageState: `${OUT}/state.json`,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + s.path, { waitUntil: "load", timeout: 60_000 });
    // ASSERT THE PAGE IS STYLED before trusting any height. Twice now a probe
    // has produced confident numbers from a server whose build directory had
    // been deleted underneath it, rendering every page with no CSS at all — an
    // 18px "stage" and a 0.033 CLS that were both fiction.
    const styled = await page.evaluate(
      () => document.styleSheets.length > 0 && getComputedStyle(document.body).margin === "0px",
    );
    if (!styled) throw new Error(`page is UNSTYLED at ${s.path} — rebuild before measuring`);
    const connecting = await page.evaluate(READ); // before the socket answers
    await page.waitForTimeout(3500);
    const settled = await page.evaluate(READ); // after
    if (connecting !== null) rows.push({ ...s, width, ...connecting });
    if (settled !== null) rows.push({ ...s, width, ...settled });
    await ctx.close();
  }
}
await browser.close();

const phases = [...new Set(rows.map((r) => r.phase))];
console.log("width  " + phases.map((p) => p.padStart(12)).join(""));
for (const w of WIDTHS) {
  const cells = phases.map((p) => {
    const hs = rows.filter((r) => r.width === w && r.phase === p).map((r) => r.h);
    return (hs.length ? String(Math.max(...hs)) : "-").padStart(12);
  });
  console.log(String(w).padStart(5) + "  " + cells.join(""));
}
console.log("\ntallest phase per width (this is the floor a single height must clear):");
for (const w of WIDTHS) {
  const hs = rows.filter((r) => r.width === w);
  const max = Math.max(...hs.map((r) => r.h));
  const min = Math.min(...hs.map((r) => r.h));
  const who = hs.find((r) => r.h === max);
  console.log(
    `  ${String(w).padStart(4)}px  min ${String(min).padStart(4)}  max ${String(max).padStart(4)}  (spread ${max - min}px, tallest = ${who?.phase})`,
  );
}
