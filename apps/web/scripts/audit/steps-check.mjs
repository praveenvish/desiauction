/** The workflow row, at the widths its rules branch on. */
import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad";
const b = await chromium.launch();
for (const w of [390, 768, 899, 900, 1440]) {
  const c = await b.newContext({ viewport: { width: w, height: 1000 } });
  const p = await c.newPage();
  await p.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 90_000 });
  const el = p.locator(".mk-steps").first();
  if (!(await el.count())) {
    console.log(`${w}px: .mk-steps absent`);
    await c.close();
    continue;
  }
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  const m = await el.evaluate((n) => {
    const li = [...n.querySelectorAll("li")];
    const tops = [...new Set(li.map((x) => Math.round(x.getBoundingClientRect().top)))];
    const bodies = [...n.querySelectorAll("p")].map((x) =>
      Math.round(x.getBoundingClientRect().top),
    );
    return {
      cards: li.length,
      rows: tops.length,
      bodiesAligned: new Set(bodies).size === 1,
      docOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  console.log(
    `${String(w).padStart(4)}px  cards=${m.cards} rows=${m.rows}  bodies-start-level=${m.bodiesAligned}  page-overflow=${m.docOverflow}`,
  );
  if (w === 1440) await el.screenshot({ path: `${OUT}/steps-1440.png` });
  if (w === 390) await el.screenshot({ path: `${OUT}/steps-390.png` });
  await c.close();
}
await b.close();
