/** The status ribbon's height before and after the socket answers, per width. */
import { chromium } from "@playwright/test";
const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";
const READ = `(() => {
  const el = document.querySelector('[data-testid="status-ribbon"]');
  return el === null ? null : Math.round(el.getBoundingClientRect().height);
})()`;
const browser = await chromium.launch();
for (const width of [320, 390, 430, 768, 1024, 1440]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    storageState: `${OUT}/${process.env.AUDIT_STATE ?? "state"}.json`,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/seasons/demo-premier-league/auction/live`, { waitUntil: "load" });
  if (!(await page.evaluate(() => document.styleSheets.length > 0)))
    throw new Error("UNSTYLED — rebuild first");
  const before = await page.evaluate(READ);
  await page.waitForTimeout(3200);
  const after = await page.evaluate(READ);
  console.log(
    `  ${String(width).padStart(4)}px  connecting ${String(before).padStart(4)}  connected ${String(after).padStart(4)}  delta ${after - before > 0 ? "+" : ""}${after - before}`,
  );
  await ctx.close();
}
await browser.close();
