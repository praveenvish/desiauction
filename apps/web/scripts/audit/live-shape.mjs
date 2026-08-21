/**
 * WHAT CHANGES SIZE IN THE LIVE ROOM, AND WHEN.
 *
 * The attribution says `live-col` travels 630px upward when the socket answers,
 * which is a symptom rather than a cause: a column moves because something
 * ABOVE it changed height. This samples the height of every major block on a
 * timer through the connect, so the block that actually resizes names itself.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const SAMPLE = `(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), top: Math.round(r.top + scrollY) };
  };
  return {
    t: Math.round(performance.now()),
    connected: document.querySelector('[data-testid="ceremony"]')?.dataset.phase ?? "-",
    ceremony: pick('[data-testid="ceremony"]'),
    lotHero: pick(".lot-hero"),
    bidFeed: pick('[data-testid="bid-feed"]'),
    progress: pick('[data-testid="auction-progress"]'),
    purses: pick('[data-testid="purse-board"]'),
    pool: pick('[data-testid="pool-summary"]'),
    squads: pick('[data-testid="squad-board"]'),
    grid: pick(".live-grid"),
    body: Math.round(document.body.scrollHeight),
  };
})()`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  storageState: `${OUT}/state.json`,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
// `domcontentloaded`, not `load`: the shift lands around 340ms and the first
// version of this probe took its first sample at 506ms — after the event it was
// meant to catch. Sampling has to start before the socket answers.
await page.goto(`${BASE}/seasons/demo-premier-league/auction/live`, {
  waitUntil: "domcontentloaded",
});

const samples = [];
for (let i = 0; i < 26; i++) {
  samples.push(await page.evaluate(SAMPLE));
  await page.waitForTimeout(45);
}
await browser.close();

const keys = ["ceremony", "lotHero", "bidFeed", "progress", "purses", "pool", "squads", "grid"];
console.log(["  t(ms)", "phase".padEnd(11), ...keys.map((k) => k.padStart(9)), "  body"].join(" "));
let prev = null;
for (const s of samples) {
  const row = [
    String(s.t).padStart(6),
    String(s.connected).padEnd(11),
    ...keys.map((k) => String(s[k]?.h ?? "-").padStart(9)),
    String(s.body).padStart(6),
  ].join(" ");
  console.log(row);
  prev = s;
}
console.log("\nheight deltas across the connect:");
const first = samples[0];
const last = samples[samples.length - 1];
for (const k of [...keys]) {
  const a = first[k]?.h ?? 0;
  const b = last[k]?.h ?? 0;
  if (a !== b)
    console.log(
      `  ${k.padEnd(10)} ${String(a).padStart(5)} -> ${String(b).padStart(5)}  (${b - a > 0 ? "+" : ""}${b - a}px)`,
    );
}
