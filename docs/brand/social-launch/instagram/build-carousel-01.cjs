// build-carousel-01.cjs — "Every local auction has these 5 people." 7 slides, 1080x1350.
//
// usage (repo root): mise exec -- node docs/brand/social-launch/instagram/build-carousel-01.cjs
//
// A tag-a-friend carousel: the five people every league owner will recognise,
// then the product as the punchline. Set in the site's own faces (Clash Display
// for display, Geist for text) on the site's ink-and-gold palette.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

// Pages are built with setContent (origin about:blank), which may not load
// file:// URLs, so fonts are inlined as data URLs.
const font = (file) => `"data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}"`;

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(__dirname, "carousel-01");
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST_DIR = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files",
);
const MARK = fs.readFileSync(path.join(ROOT, "docs/brand/kit/logo/da-mark.svg"), "utf8");

const PEOPLE = [
  ["🧾", "The organiser", "Holding a spreadsheet, a mic and fourteen WhatsApp groups. Hasn't eaten since 4 pm."],
  ["⏱️", "The last-second bidder", "Waits for “going twice” every. single. time."],
  ["🧮", "The purse calculator", "Swears they had ₹20,000 left. They did not."],
  ["✋", "The “that bid didn’t count” guy", "Every auction. Every year. Same guy."],
  ["📱", "The player", "Refreshing the group since 7:41 pm to find out his price."],
];

const css = `
@font-face{font-family:Clash;src:url(${font(CLASH)}) format("woff2");font-weight:600}
@font-face{font-family:Geist;src:url(${font(path.join(GEIST_DIR, "geist-sans-latin-500-normal.woff2"))}) format("woff2");font-weight:500}
@font-face{font-family:Geist;src:url(${font(path.join(GEIST_DIR, "geist-sans-latin-600-normal.woff2"))}) format("woff2");font-weight:600}
html,body{margin:0}*{box-sizing:border-box}
.f{position:relative;width:1080px;height:1350px;overflow:hidden;color:#F6F9FF;
   background:radial-gradient(110% 55% at 85% 0%,#1d1a12 0%,#0B1018 55%);padding:0 96px 120px;
   display:flex;flex-direction:column;justify-content:center}
.k{font:600 28px/1 Geist,sans-serif;letter-spacing:.16em;color:#E6B24A;margin:0}
h1{font:600 150px/0.98 Clash,sans-serif;letter-spacing:-.02em;margin:40px 0 0}
h2{font:600 104px/1.0 Clash,sans-serif;letter-spacing:-.02em;margin:28px 0 0}
em{font-style:normal;color:#E6B24A;white-space:nowrap}
.big{font:600 300px/0.9 Clash,sans-serif;color:#E6B24A;letter-spacing:-.04em;margin:0}
.emo{position:absolute;right:96px;top:200px;font-size:170px;line-height:1}
p.t{font:500 52px/1.32 Geist,sans-serif;color:#C9D4E8;margin:44px 0 0;max-width:860px}
.foot{position:absolute;left:96px;right:96px;bottom:96px;display:flex;align-items:center;justify-content:space-between}
.foot .m{display:flex;align-items:center;gap:18px;font:600 30px/1 Geist,sans-serif;color:#9FB0CC}
.foot svg{width:56px;height:56px}
.pg{font:600 28px/1 Geist,sans-serif;color:#48597A;letter-spacing:.08em}
.swipe{font:600 34px/1 Geist,sans-serif;color:#0B1018;background:#E6B24A;border-radius:999px;padding:22px 34px}
.cta{align-self:flex-start;margin-top:64px;padding:30px 44px;border-radius:24px;background:#E6B24A;
     font:600 46px/1 Clash,sans-serif;color:#0B1018;white-space:nowrap}
`;

const foot = (n, right) =>
  `<div class="foot"><div class="m">${MARK}<span>@desiauction</span></div>${right ?? `<span class="pg">${n} / 7</span>`}</div>`;

const slides = [
  `<p class="k">AUCTION NIGHT · A FIELD GUIDE</p>
   <h1>Every local auction has these <em>5 people.</em></h1>
   <p class="t">Tag your league’s owners group. They know who they are.</p>
   ${foot(1, `<span class="swipe">Swipe →</span>`)}`,
  ...PEOPLE.map(
    ([emo, title, line], i) => `<div class="emo">${emo}</div>
   <p class="big">0${i + 1}</p>
   <h2>${title}</h2>
   <p class="t">${line}</p>
   ${foot(i + 2)}`,
  ),
  `<p class="k">AND THEN THERE’S THE BIG SCREEN</p>
   <h2>On DesiAuction, every bid lands on <em>every screen</em> at once.</h2>
   <p class="t">The projector, every owner’s phone, every spectator’s link. Nobody argues with the big screen.</p>
   <div class="cta">Run yours free → desiauction.in</div>
   ${foot(7)}`,
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  for (const [i, body] of slides.entries()) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><div class="f">${body}</div>`, {
      waitUntil: "load",
    });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, `slide-${i + 1}.png`);
    await page.screenshot({ path: file });
    await page.close();
    console.log(path.relative(ROOT, file));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
