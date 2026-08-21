/**
 * CONTRAST FROM THE PIXELS THAT WERE ACTUALLY PAINTED.
 *
 * The computed-colour probe could not judge text sitting on a gradient: it
 * walks up for an opaque `background-color`, and a gradient has none, so it
 * kept climbing and compared the text against a surface three ancestors away.
 * That produced dozens of impossible 1.07:1 readings on a hero that is plainly
 * legible. Those are the probe's failure, not the product's.
 *
 * This settles the shortlist a different way, with no model of the stack at
 * all: screenshot the element, then read the real RGB values. Text pixels are
 * the extreme end of the luminance histogram; background pixels are the modal
 * colour. Contrast between those two is what a person's eye is given.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
const OUT =
  process.env.AUDIT_OUT ??
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad/audit";

// Every candidate the computed probe raised that was NOT explained by a
// gradient, plus the two it flagged on a gradient that hand-arithmetic also
// failed independently.
const CASES = [
  {
    path: "/home",
    auth: true,
    theme: "floodlight",
    sel: ".app-shell_rail-tagline__3ujs2, [class*=rail-tagline]",
    what: "rail tagline 8px",
  },
  {
    path: "/home",
    auth: true,
    theme: "daylight",
    sel: "[class*=rail-tagline]",
    what: "rail tagline 8px (daylight)",
  },
  { path: "/home", auth: true, theme: "daylight", sel: ".home-ic--warn", what: "warn icon chip" },
  { path: "/home", auth: true, theme: "daylight", sel: ".home-ic--info", what: "info icon chip" },
  {
    path: "/home",
    auth: true,
    theme: "daylight",
    sel: ".home-ic--violet",
    what: "violet icon chip (off-palette)",
  },
  {
    path: "/home",
    auth: true,
    theme: "daylight",
    sel: ".home-ic--green",
    what: "success icon chip",
  },
  {
    path: "/org/demo-club/money",
    auth: true,
    theme: "floodlight",
    sel: ".doc-link",
    what: "document number link",
  },
  {
    path: "/seasons/demo-premier-league/auction",
    auth: true,
    theme: "floodlight",
    sel: ".share-auction-button",
    what: "Open board button",
  },
  {
    path: "/support",
    auth: false,
    theme: "daylight",
    sel: ".prose-link",
    what: "support email link",
  },
  {
    path: "/",
    auth: false,
    theme: "daylight",
    sel: ".mk-hero-highlight",
    what: "hero highlight word",
  },
  { path: "/", auth: false, theme: "daylight", sel: ".mk-lead", what: "hero lead paragraph" },
  {
    path: "/",
    auth: false,
    theme: "daylight",
    sel: ".mk-stage-amount",
    what: "stage winning amount",
  },
  { path: "/", auth: false, theme: "daylight", sel: "[class*=nav-link]", what: "public nav link" },
  { path: "/c", auth: false, theme: "daylight", sel: ".public-sub", what: "directory subtitle" },
];

const lin = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const l1 = lum(a),
    l2 = lum(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const browser = await chromium.launch();
for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ...(c.auth ? { storageState: `${OUT}/state.json` } : {}),
  });
  await ctx.addInitScript(
    `try{localStorage.setItem("da-theme",${JSON.stringify(c.theme)})}catch{}`,
  );
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + c.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    const el = page.locator(c.sel).first();
    if (!(await el.count())) {
      console.log(`  --      ${c.what.padEnd(32)} not present on ${c.path}`);
      await ctx.close();
      continue;
    }
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const b64 = (await el.screenshot({ timeout: 8000 })).toString("base64");
    // Decoded in the page rather than in Node: a canvas is already there, and
    // it keeps the harness free of an image-decoding dependency.
    const pixels = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = img.height;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      return Array.from(cx.getImageData(0, 0, cv.width, cv.height).data);
    }, b64);

    // Histogram the pixels; the modal colour is the ground, and the pixel
    // furthest from it in luminance is the ink at full strength (anti-aliased
    // edge pixels sit between the two and are deliberately ignored).
    const counts = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 250) continue;
      counts.set(
        `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`,
        (counts.get(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`) ?? 0) + 1,
      );
    }
    if (counts.size < 2) {
      console.log(`  --      ${c.what.padEnd(32)} single colour`);
      await ctx.close();
      continue;
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const bg = sorted[0][0].split(",").map(Number);
    const bgL = lum(bg);
    let ink = null,
      best = -1;
    for (const [k, n] of sorted) {
      if (n < 3) continue; // stray anti-aliasing
      const px = k.split(",").map(Number);
      const d = Math.abs(lum(px) - bgL);
      if (d > best) {
        best = d;
        ink = px;
      }
    }
    const r = ratio(ink, bg);
    const verdict = r >= 4.5 ? "PASS AA" : r >= 3 ? "large/non-text only" : "FAIL";
    console.log(
      `  ${String(Math.round(r * 100) / 100).padStart(5)}:1  ${c.what.padEnd(32)} ${c.theme.padEnd(10)} ink=rgb(${ink}) bg=rgb(${bg})  ${verdict}`,
    );
  } catch (e) {
    console.log(`  ERR     ${c.what.padEnd(32)} ${String(e).slice(0, 70)}`);
  }
  await ctx.close();
}
await browser.close();
