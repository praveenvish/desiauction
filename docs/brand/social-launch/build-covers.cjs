// build-covers.cjs — the profile cover for every network: the lit pitch.
//
// usage (repo root): mise exec -- node docs/brand/social-launch/build-covers.cjs
//
// docs/06-brand-guidelines.md: "The brand's signature image is the lit pitch in
// darkness: a field of Ink with one lit focal area." So the cover is exactly
// that, and nothing else: an Ink field, one floodlight falling on a faint
// pitch, and the full DesiAuction lockup (vector, docs/brand/kit) standing in
// the light. No product screens and no names — a cover represents the brand,
// not one league or one player. One line of small type carries the address.
//
// The scene is drawn at a 1400x400 reference and scaled into each platform's
// safe area, centred, so no profile photo or crop ever touches the logo.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = (file) => `"data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}"`;
const GEIST_MONO = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-mono@5.2.8/node_modules/@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2",
);
const LOCKUP = fs.readFileSync(path.join(ROOT, "docs/brand/kit/logo/lockup-dark.svg"), "utf8");

// [file, canvas w, canvas h, safe box {x, y, w, h}]
const COVERS = [
  // Profile photo covers the lower-left corner on desktop.
  ["linkedin/profile-banner-1584x396.png", 1584, 396, { x: 380, y: 20, w: 1180, h: 356 }],
  // 1546x423 is the area every device shows (TV shows the full canvas).
  ["youtube/banner-2560x1440.png", 2560, 1440, { x: 507, y: 508, w: 1546, h: 423 }],
  // Profile photo bottom-left; phones trim top and bottom.
  ["x/header-1500x500.png", 1500, 500, { x: 260, y: 50, w: 1200, h: 400 }],
  // Phones crop the sides to roughly the centre 1280 px.
  ["facebook/cover-1640x624.png", 1640, 624, { x: 180, y: 100, w: 1280, h: 424 }],
];

const W0 = 1400;
const H0 = 400;

const page = (W, H, box) => {
  const k = Math.min(box.w / W0, box.h / H0);
  const cx = box.x + box.w / 2; // the light and the logo share one centre line
  const cy = box.y + box.h / 2;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:GeistMono;src:url(${font(GEIST_MONO)}) format("woff2");font-weight:500}
html,body{margin:0}*{box-sizing:border-box}
.f{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#070A0F}
/* the floodlight: a soft cone from a lamp far above the frame, fading as it
   falls, so it has no edges anywhere — only light */
.beam{position:absolute;inset:0;
  background:conic-gradient(from 162deg at ${cx}px ${cy - 1100 * k}px,
    rgba(246,249,255,0) 0deg,rgba(246,249,255,.05) 7deg,rgba(246,249,255,.1) 18deg,
    rgba(246,249,255,.05) 29deg,rgba(246,249,255,0) 36deg,rgba(246,249,255,0) 360deg);
  -webkit-mask:linear-gradient(180deg,transparent ${cy - 420 * k}px,#000 ${cy - 60 * k}px,#000 ${cy + 120 * k}px,transparent ${cy + 260 * k}px);
          mask:linear-gradient(180deg,transparent ${cy - 420 * k}px,#000 ${cy - 60 * k}px,#000 ${cy + 120 * k}px,transparent ${cy + 260 * k}px)}
/* where it lands: a warm pool of light on the ground */
.pool{position:absolute;left:${cx - 620 * k}px;top:${cy + 70 * k}px;width:${1240 * k}px;height:${200 * k}px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(230,178,74,.17),rgba(230,178,74,.05) 55%,rgba(230,178,74,0) 100%)}
.halo{position:absolute;left:${cx - 600 * k}px;top:${cy - 260 * k}px;width:${1200 * k}px;height:${520 * k}px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(31,42,61,.5),rgba(7,10,15,0))}
/* the one lit thing */
.lock{position:absolute;left:${cx - 330 * k}px;top:${cy - 95 * k}px;width:${660 * k}px}
.lock svg{display:block;width:100%;height:auto}
.url{position:absolute;left:0;right:0;top:${cy + 138 * k}px;text-align:center;
  font:500 ${17 * k}px/1 GeistMono,monospace;letter-spacing:.18em;color:#7285A6}
</style><div class="f">
<div class="halo"></div><div class="beam"></div><div class="pool"></div>
<div class="lock">${LOCKUP}</div>
<div class="url" style="left:${cx - W / 2}px;width:${W}px;right:auto">desiauction.in</div>
</div>`;
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
