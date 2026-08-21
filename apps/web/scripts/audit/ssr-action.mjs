/**
 * IS THE ACTION IN THE SERVER'S HTML?
 *
 * The whole point of the `@action` parallel route. With JavaScript disabled the
 * browser gets exactly what the server sent and runs no effect, so if the
 * trigger is present here it was rendered on the server — which is the property
 * `PageAction`'s `useEffect` could never have.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

const CASES = [
  { path: "/home", testid: "home-new-tournament", expect: true },
  { path: "/orgs", testid: "new-org", expect: true },
  { path: "/tournaments", testid: "new-tournament", expect: true },
  // Actionless console routes must stay actionless — a slot that leaks its
  // previous route's action would be worse than the shift it replaced.
  { path: "/account", testid: null, expect: false },
  { path: "/inbox", testid: null, expect: false },
  { path: "/seasons/demo-premier-league/teams", testid: null, expect: false },
  { path: "/admin", testid: null, expect: false },
];

const browser = await chromium.launch();
let bad = 0;
for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: `${OUT}/state.json`,
    javaScriptEnabled: false, // exactly what the server sent
  });
  const page = await ctx.newPage();
  const res = await page.goto(BASE + c.path, { waitUntil: "domcontentloaded", timeout: 90_000 });
  // RENDERED, not merely present. A parallel-route slot is always a node, so
  // the wrapper exists on every console route; what matters is whether it draws
  // anything and takes space. An empty one is hidden by `.page-action:empty`.
  const inBar = await page.evaluate(() => {
    const slot = document.querySelector('[class*="page-action"]');
    if (slot === null) return null;
    const box = slot.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    return (slot.textContent ?? "").trim().slice(0, 40);
  });
  const found = c.testid !== null ? await page.locator(`[data-testid="${c.testid}"]`).count() : 0;
  const ok = c.expect ? found > 0 && inBar !== null : inBar === null;
  if (!ok) bad++;
  console.log(
    `${ok ? " PASS" : " FAIL"}  ${String(res?.status()).padEnd(3)} ${c.path.padEnd(40)} action-in-bar=${JSON.stringify(inBar)}`,
  );
  await ctx.close();
}
await browser.close();
console.log(bad === 0 ? "\nall server-rendered as expected" : `\n${bad} failed`);
process.exit(bad > 0 ? 1 : 0);
