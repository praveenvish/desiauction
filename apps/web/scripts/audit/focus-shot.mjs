import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 900, height: 700 } })).newPage();
await p.goto("http://localhost:3200/search", { waitUntil: "networkidle" });
const el = p.locator('input[name="q"], input[type="search"]').first();
const box = await el.boundingBox();
const clip = { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 };
await p.evaluate(() => document.activeElement?.blur());
await p.waitForTimeout(150);
await p.screenshot({ path: `${OUT}/focus-blur.png`, clip });
await el.evaluate((n) => n.focus({ preventScroll: true }));
await p.keyboard.press("Shift+Tab");
await p.keyboard.press("Tab");
await p.waitForTimeout(250);
await p.screenshot({ path: `${OUT}/focus-on.png`, clip });
console.log("classes:", await el.getAttribute("class"));
console.log(
  "focused styles:",
  await el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return {
      outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor,
      boxShadow: cs.boxShadow,
      border: cs.border,
      bg: cs.backgroundColor,
    };
  }),
);
await b.close();
