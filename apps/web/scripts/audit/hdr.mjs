import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad";
const b = await chromium.launch();
const c = await b.newContext({
  viewport: { width: 390, height: 844 },
  storageState: `${OUT}/audit/state.json`,
});
const p = await c.newPage();
await p.goto("http://localhost:3200/home", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/hdr-full.png` });
console.log(
  "h1:",
  await p
    .locator("h1")
    .first()
    .textContent()
    .catch(() => "?"),
);
console.log("topbar classes:", await p.locator("header").first().getAttribute("class"));
console.log("action present:", await p.locator('[class*="page-action"]').count());
console.log(
  "topbar height:",
  await p
    .locator("header")
    .first()
    .evaluate((n) => Math.round(n.getBoundingClientRect().height)),
);
await b.close();
