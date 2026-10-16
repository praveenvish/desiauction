// build-stories.cjs — the four evergreen story cards behind the Instagram
// highlights: START, AUCTION, PRICING, ASK. 1080x1920.
//
// usage (repo root): mise exec -- node docs/brand/social-launch/instagram/build-stories.cjs
//
// Same scene as the covers (Ink field, one floodlight, the full lockup) so the
// highlights read as one family. Every claim is the website's own copy:
// marketing.ts (free tier, beta promise), support.ts (reply within a day).
// Text stays inside the story safe area (y 250-1580).

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = (file) => `"data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}"`;
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST_DIR = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files",
);
const MONO = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-mono@5.2.8/node_modules/@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2",
);
const LOCKUP = fs.readFileSync(path.join(ROOT, "docs/brand/kit/logo/lockup-dark.svg"), "utf8");
const OUT = path.join(__dirname, "stories");

const STORIES = {
  "01-start": `
    <p class="k">LIVE PLAYER AUCTIONS · 12 SPORTS</p>
    <h1>Registration se <em>SOLD</em> tak.<br>Ek hi jagah.</h1>
    <p class="t">Owners bid on their phones. The hall watches the big screen. Every sale lands on the record.</p>`,
  "02-auction": `
    <p class="k">HOW IT WORKS</p>
    <h1>Auction night,<br><em>sorted.</em></h1>
    <ol>
      <li><b>01</b><span>Season ready in 2 minutes</span></li>
      <li><b>02</b><span>Players register from one WhatsApp link</span></li>
      <li><b>03</b><span>Owners bid on phones, big screen updates live</span></li>
      <li><b>04</b><span>SOLD → poster, squads, purse, receipts</span></li>
    </ol>`,
  "03-pricing": `
    <p class="k">PRICING</p>
    <h1>Free during<br><em>beta.</em></h1>
    <p class="t">Always free for up to 4 teams and 40 players.</p>
    <p class="t">Tournaments started during beta stay free forever.</p>`,
  "04-ask": `
    <p class="k">ASK US</p>
    <h1>Auction night ka<br><em>sawaal?</em></h1>
    <p class="t">DM us here. We answer in person during beta and get back within a day — faster on auction night.</p>`,
};

const page = (body) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Clash;src:url(${font(CLASH)}) format("woff2");font-weight:600}
@font-face{font-family:Geist;src:url(${font(path.join(GEIST_DIR, "geist-sans-latin-500-normal.woff2"))}) format("woff2");font-weight:500}
@font-face{font-family:Geist;src:url(${font(path.join(GEIST_DIR, "geist-sans-latin-600-normal.woff2"))}) format("woff2");font-weight:600}
@font-face{font-family:GeistMono;src:url(${font(MONO)}) format("woff2");font-weight:500}
html,body{margin:0}*{box-sizing:border-box}
.f{position:relative;width:1080px;height:1920px;overflow:hidden;background:#070A0F}
.beam{position:absolute;inset:0;background:conic-gradient(from 162deg at 540px -700px,
  rgba(246,249,255,0) 0deg,rgba(246,249,255,.05) 7deg,rgba(246,249,255,.1) 18deg,
  rgba(246,249,255,.05) 29deg,rgba(246,249,255,0) 36deg,rgba(246,249,255,0) 360deg);
  -webkit-mask:linear-gradient(180deg,#000 0,#000 60%,transparent 85%)}
.pool{position:absolute;left:40px;top:1380px;width:1000px;height:300px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(230,178,74,.18),rgba(230,178,74,.05) 55%,rgba(230,178,74,0))}
.lock{position:absolute;left:96px;top:300px;width:560px}
.lock svg{display:block;width:100%;height:auto}
.c{position:absolute;left:96px;right:96px;top:560px}
.k{margin:0;font:600 30px/1 Geist,sans-serif;letter-spacing:.16em;color:#E6B24A}
h1{margin:34px 0 0;font:600 112px/1.0 Clash,sans-serif;letter-spacing:-.02em;color:#F6F9FF}
h1 em{font-style:normal;color:#E6B24A}
p.t{margin:44px 0 0;font:500 46px/1.35 Geist,sans-serif;color:#C9D4E8}
ol{list-style:none;margin:56px 0 0;padding:0}
li{display:flex;gap:34px;align-items:baseline;padding:26px 0;border-top:1px solid rgba(159,176,204,.18)}
li b{font:500 34px/1 GeistMono,monospace;color:#E6B24A}
li span{font:500 44px/1.25 Geist,sans-serif;color:#F6F9FF}
.url{position:absolute;left:0;right:0;top:1500px;text-align:center;font:500 34px/1 GeistMono,monospace;letter-spacing:.14em;color:#9FB0CC}
</style><div class="f"><div class="beam"></div><div class="pool"></div>
<div class="lock">${LOCKUP}</div><div class="c">${body}</div><div class="url">desiauction.in</div></div>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  for (const [name, body] of Object.entries(STORIES)) {
    const p = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await p.setContent(page(body), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    const out = path.join(OUT, `${name}.png`);
    await p.screenshot({ path: out });
    await p.close();
    console.log(path.relative(ROOT, out));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
