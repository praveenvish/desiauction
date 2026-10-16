// render.cjs — builds the Instagram highlight covers and renders every launch
// asset in this folder to PNG with the Mac's own Chrome (Playwright).
//
// usage (from the repo root):  node docs/brand/social-launch/render.cjs
//
// Highlight covers are generated from the product's own icon set
// (packages/ui/src/icons/glyphs, Phosphor, MIT) so the profile speaks the same
// visual language as the app. Posts are the docs/brand/templates cards with new
// copy; edit their COPY block, then re-run this.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const GLYPHS = path.join(ROOT, "packages/ui/src/icons/glyphs");
const IG = path.join(__dirname, "instagram");

// The seven highlights from docs/operations/SOCIAL_SETUP_SHEET.md, in order.
// No gavel: the brand spec rules gavel iconography out (every competitor uses one).
const HIGHLIGHTS = [
  ["01-start", "IconPlay"],
  ["02-auction", "IconTv"],
  ["03-proof", "IconShieldCheck"],
  ["04-pricing", "IconRupee"],
  ["05-nights", "IconMoon"],
  ["06-players", "IconUsers"],
  ["07-ask", "IconMessageCircle"],
];

function regularPath(icon) {
  const src = fs.readFileSync(path.join(GLYPHS, `${icon}.tsx`), "utf8");
  const m = src.match(/regular:\s*\(\s*([\s\S]*?)\s*\),\s*fill:/);
  if (!m) throw new Error(`no regular glyph in ${icon}`);
  return m[1].replace(/\s*\/>/g, "/>");
}

// 1080x1920 story frame. Instagram crops the cover to the centre circle, so the
// glyph sits dead centre at a size that reads at the 64px highlight bubble.
function highlightHtml(glyph) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#0B1018}
.f{width:1080px;height:1920px;display:grid;place-items:center;background:#0B1018}
svg{width:400px;height:400px;fill:#F6F9FF}
</style></head><body><div class="f">
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">${glyph}</svg>
</div></body></html>\n`;
}

async function main() {
  const jobs = [];
  for (const [name, icon] of HIGHLIGHTS) {
    const html = path.join(IG, "highlights", `${name}.html`);
    fs.writeFileSync(html, highlightHtml(regularPath(icon)));
    jobs.push([html, 1080, 1920]);
  }
  for (const f of fs.readdirSync(path.join(IG, "posts")).filter((f) => f.endsWith(".html")).sort()) {
    jobs.push([path.join(IG, "posts", f), 1080, 1350]);
  }

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--disable-lcd-text", "--disable-font-subpixel-positioning", "--force-color-profile=srgb"],
  });
  for (const [html, width, height] of jobs) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto("file://" + html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const out = html.replace(/\.html$/, ".png");
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
    await page.close();
    console.log(`${path.relative(__dirname, out)}  ${width}x${height}`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
