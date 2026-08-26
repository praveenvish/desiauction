/**
 * GUESTHOME VIEWPORT QA HARNESS
 *
 * Measures the public landing page at every breakpoint the design brief names,
 * and reports the things a screenshot cannot tell you: horizontal overflow, the
 * real section paddings after media queries resolve, whether the fold shows the
 * next section, tap-target sizes, and reduced-motion behaviour.
 *
 * Run against a dev server:  node scripts/guesthome-qa.mjs [url]
 * Screenshots land in .qa-shots/ (gitignored scratch).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3200/";
const OUT = process.env["QA_OUT"] ?? ".qa-shots";

const VIEWPORTS = [
  { name: "desktop-lg", width: 1440, height: 900 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-sm", width: 360, height: 740 },
];

/** Everything measured inside the page, in one pass, so numbers agree. */
function probe() {
  const de = document.documentElement;
  const sections = [...document.querySelectorAll("main > section")].map((s) => {
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    return {
      cls: (s.className || "").toString().slice(0, 40),
      h: Math.round(r.height),
      top: Math.round(r.top + scrollY),
      padT: cs.paddingTop,
      padB: cs.paddingBottom,
    };
  });
  // Anything actually sticking out of the document, ignoring decorative layers
  // that are deliberately oversized inside an overflow-hidden parent.
  const bleeding = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.closest("[aria-hidden='true']")) return false;
      return r.right > de.clientWidth + 1 || r.left < -1;
    })
    .slice(0, 10)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName}.${(el.className || "").toString().slice(0, 30)} [${Math.round(r.left)}→${Math.round(r.right)}]`;
    });
  // Tap targets below the 24px WCAG 2.2 floor (2.5.8).
  const small = [...document.querySelectorAll("a, button, input, select")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24);
    })
    .slice(0, 10)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName} "${(el.textContent || "").trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    });
  const firstBand = document.querySelector("main > section:nth-of-type(2)");
  return {
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    docH: de.scrollHeight,
    overflow: de.scrollWidth > de.clientWidth,
    bleeding,
    small,
    sections,
    // Does the fold show any of the section after the hero? The brief asks for
    // header + hero + a bite of what follows.
    nextSectionTop: firstBand ? Math.round(firstBand.getBoundingClientRect().top) : null,
    foldH: innerHeight,
  };
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
let failures = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120));
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 120)}`));

  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  const r = await page.evaluate(probe);
  await page.screenshot({ path: `${OUT}/${vp.name}-fold.png` });
  await page.screenshot({ path: `${OUT}/${vp.name}-full.png`, fullPage: true });

  const bad = r.overflow || r.bleeding.length > 0 || consoleErrors.length > 0;
  if (bad) failures += 1;

  console.log(`\n━━ ${vp.name}  ${vp.width}x${vp.height} ━━`);
  console.log(
    `  overflow: ${r.overflow ? `YES *** scrollW=${r.scrollW} clientW=${r.clientW}` : "no"}   doc: ${r.docH}px`,
  );
  console.log(
    `  next section starts at y=${r.nextSectionTop} (fold ${r.foldH}) → ${
      r.nextSectionTop !== null && r.nextSectionTop < r.foldH ? "visible at fold ✓" : "BELOW FOLD"
    }`,
  );
  if (r.bleeding.length) console.log(`  bleeding: ${r.bleeding.join(" | ")}`);
  if (r.small.length) console.log(`  sub-24px targets: ${r.small.join(" | ")}`);
  if (consoleErrors.length) console.log(`  console errors: ${consoleErrors.join(" | ")}`);
  console.log(
    r.sections
      .map((s) => `    ${String(s.h).padStart(5)}px  pad ${s.padT}/${s.padB}  ${s.cls}`)
      .join("\n"),
  );
  await ctx.close();
}

// Reduced motion: the page must be fully usable and visible with motion off.
const rmCtx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
const rmPage = await rmCtx.newPage();
await rmPage.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
const hidden = await rmPage.evaluate(() => {
  // Anything left invisible when motion is disabled is a content-loss bug.
  return [...document.querySelectorAll("main h1, main h2, main h3, main p, main a")]
    .filter((el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.opacity) < 0.9 || cs.visibility === "hidden";
    })
    .slice(0, 10)
    .map(
      (el) =>
        `${el.tagName} "${(el.textContent || "").trim().slice(0, 30)}" opacity=${getComputedStyle(el).opacity}`,
    );
});
await rmPage.screenshot({ path: `${OUT}/reduced-motion.png`, fullPage: true });
console.log(`\n━━ prefers-reduced-motion ━━`);
console.log(
  hidden.length
    ? `  INVISIBLE CONTENT ***\n    ${hidden.join("\n    ")}`
    : "  all content visible ✓",
);
if (hidden.length) failures += 1;
await rmCtx.close();

await browser.close();
console.log(
  `\n${failures === 0 ? "QA PASS — no overflow, no console errors, motion-safe" : `QA: ${failures} viewport(s) with findings`}`,
);
