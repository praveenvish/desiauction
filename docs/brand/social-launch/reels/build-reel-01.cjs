// build-reel-01.cjs — "POV: you want this player." 9:16 Reel, ~14.5 s.
//
// usage (repo root):
//   mise exec -- node docs/brand/social-launch/reels/capture-demo.cjs <capDir>
//   (cd <capDir> && ffmpeg -f concat -safe 0 -i list.txt \
//      -vf "scale=1080:1920:flags=lanczos,fps=30,format=yuv420p" -c:v libx264 -crf 16 demo-raw.mp4)
//   mise exec -- node docs/brand/social-launch/reels/build-reel-01.cjs <capDir>/demo-raw.mp4
//
// The footage is the real interactive demo on desiauction.in, captured on a
// phone-sized screen. Nothing is staged or generated: the captions sit over
// the site header, and the SOLD frame is held so it registers. Needs ffmpeg.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

// Pages are built with setContent (origin about:blank), which may not load
// file:// URLs, so fonts are inlined as data URLs.
const font = (file) => `"data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}"`;

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RAW = path.resolve(process.argv[2] ?? "demo-raw.mp4");
const WORK = path.join(__dirname, ".work");
const OUT = path.join(__dirname, "reel-01-pov-bidding-war.mp4");
const KIT = path.join(ROOT, "docs/brand/kit");
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);

// Capture-time cut points (seconds into demo-raw.mp4). The SOLD card is on
// screen from ~8.2 s to ~8.5 s; A ends on it.
const A = [1.7, 8.4];
const HOLD = 1.4;
const B = [8.65, 10.4];
const STRIKE = path.join(KIT, "motion/da-strike-story-1080x1920.mp4"); // 2.0 s, has the sting
const END = 2.7;

const FONTS = `
@font-face{font-family:Clash;src:url(${font(CLASH)}) format("woff2");font-weight:600}
@font-face{font-family:Geist;src:url(${font(GEIST)}) format("woff2");font-weight:600}
html,body{margin:0;background:transparent}
*{box-sizing:border-box}`;

// Caption bar laid over the site header: ink block, Clash type, one gold word.
const bar = (html) => `<!doctype html><meta charset="utf-8"><style>${FONTS}
.b{width:1080px;height:330px;background:#0B1018;display:flex;align-items:flex-end;padding:0 72px 44px}
p{margin:0;font:600 66px/1.08 Clash,sans-serif;color:#F6F9FF;letter-spacing:-.01em}
em{font-style:normal;color:#E6B24A}
</style><div class="b"><p>${html}</p></div>`;

const endCard = `<!doctype html><meta charset="utf-8"><style>${FONTS}
.f{width:1080px;height:1920px;background:radial-gradient(120% 60% at 50% 38%,#1a1710 0%,#0B1018 62%);
   display:flex;flex-direction:column;justify-content:center;padding:0 88px 180px}
.k{font:600 30px/1 Geist,sans-serif;letter-spacing:.14em;color:#E6B24A;margin:0 0 40px}
h1{margin:0;font:600 132px/1.0 Clash,sans-serif;color:#F6F9FF;letter-spacing:-.02em}
h1 em{font-style:normal;color:#E6B24A}
.s{margin:56px 0 0;font:600 44px/1.3 Geist,sans-serif;color:#9FB0CC}
.u{display:inline-block;margin-top:64px;padding:26px 40px;border-radius:22px;background:#E6B24A;
   font:600 48px/1 Clash,sans-serif;color:#0B1018}
</style><div class="f">
<p class="k">LIVE PLAYER AUCTIONS · 12 SPORTS</p>
<h1>Every league deserves an <em>auction night.</em></h1>
<p class="s">Owners bid from their phones.<br>The hall watches the big screen.</p>
<div><span class="u">Run yours free → desiauction.in</span></div>
</div>`;

// Output-time captions. Footage time = output time + A[0] until the hold.
const CAPTIONS = [
  ["c1", 0.0, 2.3, "POV: you <em>really</em> want this player."],
  ["c2", 2.3, 4.4, "The rival owner keeps <em>bidding back</em> 😤"],
  ["c3", 4.4, 6.45, "Going once… going twice… <em>don't blink.</em>"],
  ["c4", 6.45, 9.85, "This is how auction night <em>should</em> feel."],
];

async function renderCards() {
  fs.mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  const shoot = async (html, file, w, h, transparent) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(WORK, file), omitBackground: transparent });
    await page.close();
  };
  for (const [id, , , text] of CAPTIONS) await shoot(bar(text), `${id}.png`, 1080, 330, true);
  await shoot(endCard, "end.png", 1080, 1920, false);
  await browser.close();
}

function ff(args) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

async function main() {
  await renderCards();
  const lenA = A[1] - A[0];
  const footLen = lenA + HOLD + (B[1] - B[0]);

  // 1. Footage: A, a held SOLD frame, then B — with the caption bars on top.
  const caps = CAPTIONS.map(([id]) => ["-i", path.join(WORK, `${id}.png`)]).flat();
  let chain =
    `[0:v]trim=${A[0]}:${A[1]},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${HOLD}[a];` +
    `[0:v]trim=${B[0]}:${B[1]},setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v0]`;
  CAPTIONS.forEach(([, from, to], i) => {
    chain += `;[v${i}][${i + 1}:v]overlay=0:0:enable='between(t,${from},${to})'[v${i + 1}]`;
  });
  ff([
    "-i", RAW, ...caps, "-filter_complex", chain, "-map", `[v${CAPTIONS.length}]`,
    "-r", "30", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", path.join(WORK, "foot.mp4"),
  ]);

  // 2. Footage sound: a low thump on each of the owner's three bids, the brand
  //    sting on SOLD. Bid times in output seconds (capture marks - A[0]).
  const bids = [0.41, 2.19, 3.99];
  const sold = 6.5;
  const thump = path.join(WORK, "thump.wav");
  ff(["-f", "lavfi", "-i", "aevalsrc='0.9*sin(2*PI*(70-30*t)*t)*exp(-14*t)':s=48000:d=0.4", thump]);
  const sting = path.join(KIT, "sound/da-sting.wav");
  const delays = bids.map((t, i) => `[${i}:a]adelay=${Math.round(t * 1000)}:all=1[t${i}]`);
  ff([
    ...bids.flatMap(() => ["-i", thump]), "-i", sting,
    "-filter_complex",
    `${delays.join(";")};[3:a]adelay=${Math.round(sold * 1000)}:all=1[s];` +
      `[t0][t1][t2][s]amix=inputs=4:normalize=0,apad,atrim=0:${footLen.toFixed(2)}[aout]`,
    "-map", "[aout]", "-ar", "48000", "-ac", "2", path.join(WORK, "foot.wav"),
  ]);

  // 3. End card as a clip with silence.
  ff([
    "-loop", "1", "-t", String(END), "-i", path.join(WORK, "end.png"),
    "-f", "lavfi", "-t", String(END), "-i", "anullsrc=r=48000:cl=stereo",
    "-vf", "fade=in:st=0:d=0.25,format=yuv420p", "-r", "30", "-c:v", "libx264", "-crf", "16",
    "-c:a", "aac", "-shortest", path.join(WORK, "end.mp4"),
  ]);

  // 4. Footage + strike + end card, normalised and joined.
  ff([
    "-i", path.join(WORK, "foot.mp4"), "-i", path.join(WORK, "foot.wav"), "-i", STRIKE, "-i", path.join(WORK, "end.mp4"),
    "-filter_complex",
    "[0:v]fps=30,format=yuv420p,setsar=1[v0];[2:v]scale=1080:1920,fps=30,format=yuv420p,setsar=1[v1];" +
      "[3:v]fps=30,format=yuv420p,setsar=1[v2];" +
      "[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];[2:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];" +
      "[3:a]aformat=sample_rates=48000:channel_layouts=stereo[a2];" +
      "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]",
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT,
  ]);
  console.log(path.relative(ROOT, OUT));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
