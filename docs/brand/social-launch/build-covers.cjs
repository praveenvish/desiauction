// build-covers.cjs — one cover design, cut to every network's safe area.
//
// usage (repo root): mise exec -- node docs/brand/social-launch/build-covers.cjs
//
// The block (kicker, two-line headline, sub-line, SOLD card) is drawn once at a
// 1060x260 reference size and scaled into each platform's safe zone, so every
// profile shows the same thing, never under a profile photo or a crop.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = (file) => `"data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}"`;
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);

// [file, canvas w, canvas h, safe box {x, y, w, h}]
const COVERS = [
  // Profile photo covers the lower-left corner on desktop.
  ["linkedin/profile-banner-1584x396.png", 1584, 396, { x: 470, y: 70, w: 1050, h: 260 }],
  // 1546x423 is the area every device shows (TV shows the full canvas).
  ["youtube/banner-2560x1440.png", 2560, 1440, { x: 527, y: 528, w: 1506, h: 384 }],
  // Profile photo bottom-left; phones trim top and bottom.
  ["x/header-1500x500.png", 1500, 500, { x: 430, y: 110, w: 1000, h: 260 }],
  // Phones crop the sides to roughly the centre 1280 px.
  ["facebook/cover-1640x624.png", 1640, 624, { x: 250, y: 170, w: 1140, h: 284 }],
];

const page = (W, H, box) => {
  const k = Math.min(box.w / 1060, box.h / 260);
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Clash;src:url(${font(CLASH)}) format("woff2");font-weight:600}
@font-face{font-family:Geist;src:url(${font(GEIST)}) format("woff2");font-weight:600}
html,body{margin:0}*{box-sizing:border-box}
.f{position:relative;width:${W}px;height:${H}px;overflow:hidden;
   background:radial-gradient(60% 120% at ${((box.x + box.w * 0.82) / W) * 100}% 50%,#1f1b11 0%,#0B1018 60%)}
.b{position:absolute;left:${box.x}px;top:${box.y + (box.h - 260 * k) / 2}px;width:1060px;height:260px;
   transform:scale(${k});transform-origin:0 0}
.k{position:absolute;left:0;top:0;font:600 18px/1 Geist,sans-serif;letter-spacing:.16em;color:#E6B24A;margin:0}
h1{position:absolute;left:0;top:36px;margin:0;font:600 62px/1.0 Clash,sans-serif;letter-spacing:-.02em;color:#F6F9FF}
h1 em{font-style:normal;color:#E6B24A}
.s{position:absolute;left:0;top:190px;margin:0;font:600 22px/1 Geist,sans-serif;color:#9FB0CC}
.sold{position:absolute;right:0;top:10px;width:250px;height:240px;border-radius:26px;
   background:linear-gradient(160deg,#F2CC6B 0%,#E6B24A 55%,#C9952F 100%);
   display:flex;flex-direction:column;align-items:center;justify-content:center}
.sold b{font:600 76px/1 Clash,sans-serif;color:#0B1018;letter-spacing:-.02em}
.sold span{margin-top:14px;font:600 14px/1 Geist,sans-serif;letter-spacing:.1em;color:#0B1018}
</style><div class="f"><div class="b">
<p class="k">LIVE PLAYER AUCTIONS · 12 SPORTS · FREE IN BETA</p>
<h1>Every league deserves<br>an <em>auction night.</em></h1>
<p class="s">Owners bid from their phones. The hall watches the big screen.</p>
<div class="sold"><b>SOLD</b><span>TO FALCONS · ₹45,000</span></div>
</div></div>`;
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  for (const [file, W, H, box] of COVERS) {
    const out = path.join(__dirname, file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const p = await browser.newPage({ viewport: { width: W, height: H } });
    await p.setContent(page(W, H, box), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: out });
    await p.close();
    console.log(path.relative(ROOT, out));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
