// build-ghar-ka-stories.cjs — the two Instagram/Facebook Stories that go with
// reel 02 ("Remote kiska?"): a poll card (the poll sticker is added in the app,
// over the empty gold frame) and the next-day result card (link sticker space).
//
// usage (repo root): mise exec -- node docs/brand/social-launch/reels/build-ghar-ka-stories.cjs

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAP = path.join(__dirname, ".work/ghar-ka");
const OUT = path.join(ROOT, "docs/brand/social-launch/instagram/stories");
const LOCKUP = path.join(ROOT, "docs/brand/kit/png/lockup-dark-2400.png");

const b64 = (file) => fs.readFileSync(file).toString("base64");
const font = (file) => `url("data:font/woff2;base64,${b64(file)}") format("woff2")`;
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);

const CSS = `
@font-face{font-family:Clash;src:${font(CLASH)};font-weight:600}
@font-face{font-family:Geist;src:${font(GEIST)};font-weight:600}
*{box-sizing:border-box}html,body{margin:0}
.s{width:1080px;height:1920px;background:radial-gradient(120% 60% at 50% 35%,#1a1710 0%,#0B1018 62%);
   color:#F6F9FF;font-family:Geist,sans-serif;padding:150px 88px 0;position:relative;overflow:hidden}
.k{font:600 30px/1 Geist;letter-spacing:.14em;color:#E6B24A;margin:0 0 36px}
h1{margin:0;font:600 120px/1.0 Clash;letter-spacing:-.02em}
h1 em{font-style:normal;color:#E6B24A}
.p{margin:40px 0 0;font:600 44px/1.3 Geist;color:#9FB0CC}
.slot{margin-top:70px;height:560px;border-radius:36px;
      display:flex;align-items:center;justify-content:center;font:600 30px/1.3 Geist;color:rgba(230,178,74,.7);text-align:center}
.shot{margin-top:60px;display:flex;justify-content:center}
.shot div{width:600px;height:640px;border-radius:40px;border:6px solid #2a3344;overflow:hidden}
.shot img{width:100%;display:block}
.label{position:absolute;left:0;right:0;bottom:60px;text-align:center;font:600 26px/1 Geist;letter-spacing:.06em;color:#6f7f99}
`;

const logo = `<img src="data:image/png;base64,${b64(LOCKUP)}" style="width:520px;display:block;margin:0 0 90px">`;

const poll = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="s">
${logo}
<p class="k">GHAR KA AUCTION</p>
<h1>Aapke ghar mein <em>remote</em> kiske paas? 📺</h1>
<p class="p">Sach batana. 😄</p>
<div class="slot"></div>
<div class="label">@desiauction</div></div>`;

const result = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="s">
${logo}
<p class="k">GHAR KA AUCTION · RESULT</p>
<h1>Hamare ghar mein? <em>Dadi.</em> 🏆</h1>
<div class="shot"><div><img src="data:image/png;base64,${b64(path.join(CAP, "phone-90-Dadi.png"))}"></div></div>
<p class="p" style="text-align:center">SOLD, without the shouting.<br>Apna auction chalao — free.</p>
<div class="label">Demo auction · points, not money</div></div>`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const [name, html] of [
    ["05-ghar-ka-poll", poll],
    ["06-ghar-ka-result", result],
  ]) {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(path.relative(ROOT, path.join(OUT, `${name}.png`)));
  }
  await browser.close();
})();
