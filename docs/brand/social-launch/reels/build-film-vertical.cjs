// build-film-vertical.cjs — the 100 s product film ("Registration se SOLD tak")
// reframed 9:16 for Instagram, Facebook and Threads Reels.
//
// usage (repo root):
//   mise exec -- node docs/brand/social-launch/reels/build-film-vertical.cjs <film-16x9.mp4>
//
// The 16:9 film sits full-width in the middle of an ink frame. Above it, a
// fixed headline; below it, a chapter label that changes with each act of the
// film, so the frame reads at feed size without covering the footage. All
// text stays clear of the Reels UI (top ~220 px, bottom ~380 px). Needs ffmpeg.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
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
const FILM = path.resolve(process.argv[2]);
const WORK = path.join(__dirname, ".work");
const OUT = path.join(__dirname, "film-01-registration-se-sold-tak-9x16.mp4");

// Acts of the film (seconds), from its scene cuts. Labels match its own words.
const ACTS = [
  [0, 13.5, "Sunday ka tournament", "Aur auction? Kaagaz pe."],
  [13.5, 24.1, "01 · Organiser", "2 minute mein season ready"],
  [24.1, 36.1, "02 · Players", "Ek link. Seedha WhatsApp pe."],
  [36.1, 44.1, "03 · Team owners", "Har owner ko ek invite link"],
  [44.1, 64.1, "04 · Auction night", "Phone se boli, big screen pe turant"],
  [64.1, 92.1, "05 · Gavel ke baad", "SOLD poster, squads, purse — sab ready"],
  [92.1, 101, "DesiAuction", "Apna auction shuru karo → desiauction.in"],
];

const css = `
@font-face{font-family:Clash;src:url(${font(CLASH)}) format("woff2");font-weight:600}
@font-face{font-family:Geist;src:url(${font(GEIST)}) format("woff2");font-weight:600}
html,body{margin:0;background:transparent}*{box-sizing:border-box}`;

const frame = `<!doctype html><meta charset="utf-8"><style>${css}
.f{width:1080px;height:1920px;background:radial-gradient(90% 40% at 50% 34%,#1c1910 0%,#0B1018 70%);position:relative}
.h{position:absolute;left:72px;right:72px;top:300px}
.k{margin:0;font:600 26px/1 Geist,sans-serif;letter-spacing:.16em;color:#E6B24A}
h1{margin:22px 0 0;font:600 92px/1.0 Clash,sans-serif;letter-spacing:-.02em;color:#F6F9FF}
h1 em{font-style:normal;color:#E6B24A}
</style><div class="f"><div class="h">
<p class="k">LIVE PLAYER AUCTIONS · 12 SPORTS</p>
<h1>Registration se <em>SOLD</em> tak.</h1>
</div></div>`;

const label = (kicker, line) => `<!doctype html><meta charset="utf-8"><style>${css}
.l{width:1080px;height:260px;padding:0 72px;display:flex;flex-direction:column;justify-content:flex-start}
.k{margin:0;font:600 26px/1 Geist,sans-serif;letter-spacing:.14em;color:#E6B24A;text-transform:uppercase}
p.t{margin:18px 0 0;font:600 54px/1.12 Clash,sans-serif;color:#F6F9FF;letter-spacing:-.01em}
</style><div class="l"><p class="k">${kicker}</p><p class="t">${line}</p></div>`;

function ff(args) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  const shoot = async (html, file, w, h, transparent) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(WORK, file), omitBackground: transparent });
    await p.close();
  };
  await shoot(frame, "v-frame.png", 1080, 1920, false);
  for (const [i, [, , k, t]] of ACTS.entries()) await shoot(label(k, t), `v-act${i}.png`, 1080, 260, true);
  await browser.close();

  // Film scaled to full width (1080x608), placed under the headline at y 640.
  const Y = 640;
  let chain = `[1:v]scale=1080:608:flags=lanczos,setsar=1[film];[0:v][film]overlay=0:${Y}:shortest=1[v0]`;
  ACTS.forEach(([from, to], i) => {
    chain += `;[v${i}][${i + 2}:v]overlay=0:${Y + 608 + 56}:enable='between(t,${from},${to - 0.001})'[v${i + 1}]`;
  });
  ff([
    "-loop", "1", "-framerate", "30", "-i", path.join(WORK, "v-frame.png"),
    "-i", FILM,
    ...ACTS.flatMap((_, i) => ["-i", path.join(WORK, `v-act${i}.png`)]),
    "-filter_complex", chain, "-map", `[v${ACTS.length}]`, "-map", "1:a",
    "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT,
  ]);
  console.log(path.relative(ROOT, OUT));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
