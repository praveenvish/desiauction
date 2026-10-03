// build-match-result-card.cjs — the "India won" card for POST-07-MATCH-DAY.md
// (posted only if India wins the 1st T20I v West Indies, Tue 6 Oct 2026). Brand
// type and colours only: no flags, logos, players or match imagery (§1a).
//
// usage (repo root): mise exec -- node docs/brand/social-launch/reels/build-match-result-card.cjs

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(ROOT, "docs/brand/social-launch/cards");
const b64 = (file) => fs.readFileSync(file).toString("base64");
const font = (file) => `url("data:font/woff2;base64,${b64(file)}") format("woff2")`;
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);
const LOCKUP = path.join(ROOT, "docs/brand/kit/png/lockup-dark-2400.png");

const card = (w, h) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Clash;src:${font(CLASH)};font-weight:600}
@font-face{font-family:Geist;src:${font(GEIST)};font-weight:600}
*{box-sizing:border-box}html,body{margin:0}
.c{width:${w}px;height:${h}px;background:radial-gradient(110% 60% at 50% 40%,#1a1710 0%,#0B1018 64%);
   color:#F6F9FF;font-family:Geist,sans-serif;padding:0 88px;display:flex;flex-direction:column;justify-content:center}
.k{font:600 30px/1 Geist;letter-spacing:.14em;color:#E6B24A;margin:0 0 36px}
h1{margin:0;font:600 ${h > 1500 ? 150 : 128}px/1.0 Clash;letter-spacing:-.02em}
h1 em{font-style:normal;color:#E6B24A}
.s{margin:44px 0 0;font:600 58px/1.2 Clash;color:#F6F9FF}
.q{margin:36px 0 0;font:600 44px/1.3 Geist;color:#9FB0CC}
.u{display:inline-block;margin-top:56px;padding:24px 38px;border-radius:22px;background:#E6B24A;font:600 48px/1 Clash;color:#0B1018}
</style><div class="c">
<img src="data:image/png;base64,${b64(LOCKUP)}" style="width:520px;display:block;margin:0 0 ${h > 1500 ? 110 : 70}px">
<p class="k">INDIA vs WEST INDIES · 1ST T20I</p>
<h1>Series shuru. <em>1–0.</em> 🏏</h1>
<p class="s">Congratulations, India!</p>
<p class="q">Aapke league ka season kab shuru?</p>
<div><span class="u">desiauction.in</span></div>
</div>`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  for (const [w, h] of [
    [1080, 1920],
    [1080, 1350],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(card(w, h), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(OUT, `match-result-india-1-0-${w}x${h}.png`);
    await page.screenshot({ path: out });
    console.log(path.relative(ROOT, out));
    await page.close();
  }
  await browser.close();
})();
