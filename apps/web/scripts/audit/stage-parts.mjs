/**
 * The stage's constituent line heights, so the on-block phase can be COMPUTED
 * rather than guessed.
 *
 * The tallest phase is a lot under the hammer — title, player, meta, bid+leader,
 * timer — and reaching it means opening a lot, which mutates the demo auction.
 * Its height is the SOLD phase (title, player, bid+leader, reason) plus one
 * `.ceremony-meta` line, so measuring the parts answers it without touching data.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const READ = `(() => {
  const st = document.querySelector('[data-testid="ceremony"]');
  if (st === null) return null;
  const cs = getComputedStyle(st);
  const h = (sel) => {
    const el = st.querySelector(sel);
    return el === null ? 0 : Math.round(el.getBoundingClientRect().height);
  };
  const lineOf = (sel) => {
    const el = st.querySelector(sel);
    if (el === null) return 0;
    const s = getComputedStyle(el);
    return Math.round(parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.4);
  };
  return {
    phase: st.dataset.phase,
    stage: Math.round(st.getBoundingClientRect().height),
    padding: Math.round(parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)),
    gap: Math.round(parseFloat(cs.rowGap) || 0),
    title: h(".ceremony-title"),
    player: h(".ceremony-player"),
    bid: h(".ceremony-bid"),
    meta: h(".ceremony-meta"),
    metaLine: lineOf(".ceremony-meta") || lineOf(".ceremony-frozen"),
    reason: h(".ceremony-frozen"),
  };
})()`;

const browser = await chromium.launch();
for (const width of [320, 390, 430, 768, 1440]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    storageState: `${OUT}/state.json`,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/seasons/demo-premier-league/auction/live`, { waitUntil: "load" });
  const styled = await page.evaluate(() => document.styleSheets.length > 0);
  if (!styled) throw new Error("page is UNSTYLED — rebuild before measuring");
  await page.waitForTimeout(3200);
  const r = await page.evaluate(READ);
  // on-block = sold + one meta line + one gap
  const projected = r === null ? 0 : r.stage + r.metaLine + r.gap;
  console.log(
    `  ${String(width).padStart(4)}px  phase=${String(r?.phase).padEnd(6)} stage=${String(r?.stage).padStart(4)}  ` +
      `pad=${String(r?.padding).padStart(3)} gap=${String(r?.gap).padStart(3)} title=${String(r?.title).padStart(3)} ` +
      `player=${String(r?.player).padStart(3)} bid=${String(r?.bid).padStart(3)} metaLine=${String(r?.metaLine).padStart(3)}` +
      `  ->  on-block projected ~${projected}px`,
  );
  await ctx.close();
}
await browser.close();
