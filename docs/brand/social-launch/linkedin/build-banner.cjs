// build-banner.cjs — LinkedIn profile banner, 1584x396.
//
// usage (repo root): mise exec -- node docs/brand/social-launch/linkedin/build-banner.cjs
//
// LinkedIn lays the round profile photo over the banner's lower-left corner
// (roughly x 0–420 on desktop), so the copy sits right of it, and the right
// edge carries the real product's SOLD card.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = (file) => `"data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}"`;
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Clash;src:url(${font(CLASH)}) format("woff2");font-weight:600}
@font-face{font-family:Geist;src:url(${font(GEIST)}) format("woff2");font-weight:600}
html,body{margin:0}*{box-sizing:border-box}
.f{position:relative;width:1584px;height:396px;overflow:hidden;
   background:radial-gradient(60% 120% at 78% 50%,#1f1b11 0%,#0B1018 60%)}
.c{position:absolute;left:470px;top:70px}
.k{font:600 18px/1 Geist,sans-serif;letter-spacing:.16em;color:#E6B24A;margin:0}
h1{margin:18px 0 0;font:600 62px/1.0 Clash,sans-serif;letter-spacing:-.02em;color:#F6F9FF}
h1 em{font-style:normal;color:#E6B24A}
.s{margin:22px 0 0;font:600 22px/1 Geist,sans-serif;color:#9FB0CC}
.sold{position:absolute;right:64px;top:78px;width:250px;height:240px;border-radius:26px;
   background:linear-gradient(160deg,#F2CC6B 0%,#E6B24A 55%,#C9952F 100%);
   display:flex;flex-direction:column;align-items:center;justify-content:center}
.sold b{font:600 76px/1 Clash,sans-serif;color:#0B1018;letter-spacing:-.02em}
.sold span{margin-top:14px;font:600 14px/1 Geist,sans-serif;letter-spacing:.1em;color:#0B1018}
</style><div class="f">
<div class="c">
<p class="k">LIVE PLAYER AUCTIONS · 12 SPORTS · FREE IN BETA</p>
<h1>Every league deserves<br>an <em>auction night.</em></h1>
<p class="s">Owners bid from their phones. The hall watches the big screen.</p>
</div>
<div class="sold"><b>SOLD</b><span>TO FALCONS · ₹45,000</span></div>
</div>`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: 1584, height: 396 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, "profile-banner-1584x396.png");
  await page.screenshot({ path: out });
  await browser.close();
  console.log(path.relative(ROOT, out));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
