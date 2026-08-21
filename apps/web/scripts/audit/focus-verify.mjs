/**
 * DID THE CONTROL VISIBLY CHANGE WHEN IT TOOK FOCUS?
 *
 * The keyboard walk flagged six controls as having no focus indicator, judged
 * by comparing computed `outline` and `box-shadow` focused vs blurred. That
 * test has a false-positive mode this codebase is likely to hit: a control can
 * signal focus through its BORDER or BACKGROUND instead, which those two
 * properties do not describe.
 *
 * So this settles it the way the contrast question was settled — by comparing
 * the pixels actually painted, blurred against focused. Anything under a small
 * difference threshold genuinely does not announce focus.
 *
 * It also re-checks the walk's "off-screen focus stop" flag, which is suspected
 * to be a timing artifact: the walk measured immediately after Tab, and a
 * browser scrolls a focused element into view asynchronously.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

/**
 * `clip` names the element whose PIXELS to compare, when that is not the
 * focused control itself. This product's search bars put the ring on a WRAPPER
 * via `:focus-within` — a good pattern, and one that made the first run of this
 * probe report a false positive: clipped to the input's own box, the ring is
 * drawn outside the frame and nothing appears to change.
 */
const CASES = [
  {
    path: "/search",
    auth: false,
    sel: 'input[name="q"]',
    clip: ".content-searchbar",
    what: "public search bar",
  },
  {
    path: "/help",
    auth: false,
    sel: 'input[name="q"]',
    clip: ".content-searchbar",
    what: "help search bar",
  },
  {
    path: "/tournaments",
    auth: true,
    sel: 'input[type="search"], input[placeholder*="Search"]',
    what: "tournaments search input",
  },
  { path: "/tournaments", auth: true, sel: "select", what: "tournaments select" },
  // Controls known to be styled, as a control group for the method itself.
  {
    path: "/login",
    auth: false,
    sel: 'button[type="submit"]',
    what: "CONTROL: login submit button",
  },
  { path: "/home", auth: true, sel: "a[href='/tournaments']", what: "CONTROL: rail link" },
];

// A real function, not a string: Playwright serializes a function and calls it
// with the argument, whereas a string is evaluated as a bare expression and the
// argument never arrives.
const decode = async (data) => {
  const img = new Image();
  img.src = "data:image/png;base64," + data;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  return Array.from(cx.getImageData(0, 0, cv.width, cv.height).data);
};

const browser = await chromium.launch();
for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(c.auth ? { storageState: `${OUT}/state.json` } : {}),
  });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + c.path, { waitUntil: "networkidle", timeout: 60_000 });
    const el = page.locator(c.sel).first();
    if (!(await el.count())) {
      console.log(`  --      ${c.what.padEnd(32)} not present`);
      await ctx.close();
      continue;
    }
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);

    // Shot the element PLUS a margin, so an outline drawn outside its box counts.
    const target = c.clip ? page.locator(c.clip).first() : el;
    const box = await target.boundingBox();
    const pad = 8;
    const clip = {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    };

    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(150);
    const before = await page.evaluate(
      decode,
      (await page.screenshot({ clip })).toString("base64"),
    );

    // Real keyboard focus, not .focus() — :focus-visible only matches when the
    // browser judges the interaction to be keyboard-driven, and calling focus()
    // programmatically does not always qualify.
    await el.evaluate((n) => n.focus({ preventScroll: true }));
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    const focused = await page.evaluate(
      () => document.activeElement?.matches(":focus-visible") ?? false,
    );
    const after = await page.evaluate(decode, (await page.screenshot({ clip })).toString("base64"));

    let changed = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (
        Math.abs(before[i] - after[i]) +
          Math.abs(before[i + 1] - after[i + 1]) +
          Math.abs(before[i + 2] - after[i + 2]) >
        24
      )
        changed++;
    }
    const pct = Math.round((changed / (before.length / 4)) * 1000) / 10;
    const verdict = pct >= 1.0 ? "VISIBLE" : pct > 0 ? "faint" : "NO CHANGE";
    console.log(
      `  ${String(pct).padStart(5)}%  ${c.what.padEnd(32)} :focus-visible=${String(focused).padEnd(5)}  ${verdict}`,
    );
  } catch (e) {
    console.log(`  ERR     ${c.what.padEnd(32)} ${String(e).slice(0, 60)}`);
  }
  await ctx.close();
}

// --- is "off-screen focus stop" real, or was the walk measuring too early? ---
console.log("\n=== off-screen focus: measured immediately vs after the scroll settles ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  let immediate = 0,
    settled = 0,
    n = 0;
  for (let i = 0; i < 22; i++) {
    await page.keyboard.press("Tab");
    const a = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    await page.waitForTimeout(400);
    const b = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    if (a === null) continue;
    n++;
    if (!a) immediate++;
    if (!b) settled++;
  }
  console.log(
    `  ${n} stops: ${immediate} off-screen when measured immediately, ${settled} still off-screen after 400ms`,
  );
  const smooth = await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior,
  );
  console.log(`  html { scroll-behavior: ${smooth} }`);
  await ctx.close();
}
await browser.close();
