// build-reel-07-match-day.cjs — "Match day." 9:16 Reel, ~11 s, for the India vs
// West Indies 1st T20I (Tue 6 Oct 2026, 7 pm IST), posted before the match.
// "Tonight the stadium. This Sunday, your ground." Payoff first
// (SOCIAL_CONTENT_PLAN.md §1b): frame one is SOLD on an owner's phone. Every
// product frame is a real screen of the demo practice auction (fictional
// players, points) or the demo registration (captures from
// capture-practice.spec.ts and capture-ek-link.spec.ts). No player names or
// faces, logos, kits, flags or match imagery (POST-07-MATCH-DAY.md, §1a).
//
// usage (repo root, captures in reels/.work/match-day/):
//   mise exec -- node docs/brand/social-launch/reels/build-reel-07-match-day.cjs

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const { makeScore } = require("./score-ghar-ka.cjs");

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAP = path.join(__dirname, ".work/match-day");
const WORK = path.join(__dirname, ".work/match-day-build");
const OUT = path.join(__dirname, "reel-07-match-day.mp4");
const COVER = path.join(__dirname, "reel-07-match-day-cover.jpg");
const KIT = path.join(ROOT, "docs/brand/kit");
const STRIKE = path.join(KIT, "motion/da-strike-story-1080x1920.mp4");
const STING = path.join(KIT, "sound/da-sting.wav");
const LOCKUP = path.join(KIT, "png/lockup-dark-2400.png");

const b64 = (file) => fs.readFileSync(file).toString("base64");
const font = (file) => `url("data:font/woff2;base64,${b64(file)}") format("woff2")`;
const img = (name) => `data:image/png;base64,${b64(path.join(CAP, `${name}.png`))}`;
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  ROOT,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);

const CSS = `
@font-face{font-family:Clash;src:${font(CLASH)};font-weight:600}
@font-face{font-family:Geist;src:${font(GEIST)};font-weight:600}
*{box-sizing:border-box}html,body{margin:0}
.f{width:1080px;height:1920px;background:radial-gradient(120% 70% at 50% 45%,#161b26 0%,#0B1018 65%);
   position:relative;overflow:hidden;font-family:Geist,sans-serif;color:#F6F9FF}
.cap{position:absolute;left:0;right:0;top:0;height:450px;padding:0 72px 36px;display:flex;align-items:flex-end;
     background:#0B1018}
.cap p{margin:0;font:600 76px/1.06 Clash,sans-serif;letter-spacing:-.01em}
.cap em{font-style:normal;color:#E6B24A}
.who{display:inline-block;font:600 34px/1 Geist;letter-spacing:.12em;color:#0B1018;background:#E6B24A;
     padding:12px 20px;border-radius:12px;margin-bottom:22px}
.stage{position:absolute;left:0;right:0;top:470px;bottom:110px;display:flex;align-items:center;justify-content:center;gap:28px}
.phone{border-radius:44px;border:6px solid #2a3344;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6);background:#0B1018}
.phone img{display:block;width:100%}
.tv{width:1000px;border-radius:22px;border:10px solid #1c2230;box-shadow:0 30px 90px rgba(0,0,0,.65);overflow:hidden}
.tv img{display:block;width:100%}
.tvlabel{position:absolute;left:0;right:0;font:600 30px/1 Geist;letter-spacing:.14em;color:#9FB0CC;text-align:center}
.grid{display:grid;grid-template-columns:470px 470px;gap:26px}
.grid .phone{height:640px;border-radius:32px}
.grid .tag{font:600 32px/1 Clash;margin:0 0 12px 6px}
.label{position:absolute;left:0;right:0;bottom:44px;text-align:center;font:600 26px/1 Geist;letter-spacing:.06em;color:#6f7f99}
`;

const logo = (w) => `<img src="data:image/png;base64,${b64(LOCKUP)}" style="width:${w}px;display:block">`;

const frame = (caption, stage, opts = {}) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<div class="f"><div style="position:absolute;top:64px;left:72px;z-index:2">${logo(330)}</div><div class="cap"><p>${opts.who ? `<span class="who">${opts.who}</span><br>` : ""}${caption}</p></div>
<div class="stage">${stage}</div>
<div class="label">Demo auction · fictional players · points, not money</div></div>`;

const phone = (name, width, crop) =>
  `<div class="phone" style="width:${width}px${crop ? `;height:${crop}px` : ""}"><img src="${img(name)}"></div>`;
const tv = (name) => `<div><div class="tv"><img src="${img(name)}"></div></div>`;
// The TV full width, and under it the phone(s) that moved it — cropped to the
// lot card and the current bid, so both screens read at phone size.
const tvWith = (name, phones) => `<div style="display:flex;flex-direction:column;align-items:center;gap:34px">
  <div class="tv" style="width:1040px">${`<img src="${img(name)}">`}</div>
  <div style="display:flex;gap:22px">${phones
    .map((p) => `<div class="phone" style="width:${phones.length > 1 ? 240 : 470}px;height:${phones.length > 1 ? 400 : 700}px;border-radius:28px"><img src="${img(p)}"></div>`)
    .join("")}</div></div>`;

// A card (desktop screenshot) shown large on the frame.
const card = (name, width = 1000) =>
  `<div style="width:${width}px;border-radius:28px;overflow:hidden;border:6px solid #2a3344;box-shadow:0 30px 90px rgba(0,0,0,.6);background:#fff"><img src="${img(name)}" style="display:block;width:100%"></div>`;
// The top of a phone: the PRACTICE bar and the lot, cropped.
const phoneTop = (name, height) =>
  `<div class="phone" style="width:640px;height:${height}px"><img src="${img(name)}"></div>`;

// [id, seconds, html, sound]
const BEATS = [
  ["b01", 2.0, frame("Aaj raat T20. 🏏 <em>Is Sunday — aapka auction?</em>", phoneTop("phoneB-sold", 1150)), "sold"],
  ["b02", 1.5, frame("Players: <em>ek link</em> se register.", card("review-7", 1000), { who: "ORGANISER" }), "bid"],
  ["b03", 1.7, frame("Owners: <em>phone se boli.</em>", `${phone("phoneA-outbid", 470)}${phone("phoneB-leading", 470)}`, { who: "OWNERS" }), "bid"],
  ["b04", 1.0, frame("<em>SOLD.</em> 🔨", phoneTop("phoneA-sold", 1150)), "sold"],
];

const END = `<!doctype html><meta charset="utf-8"><style>${CSS}
.e{width:1080px;height:1920px;background:radial-gradient(120% 60% at 50% 38%,#1a1710 0%,#0B1018 62%);
   display:flex;flex-direction:column;justify-content:center;padding:0 88px 160px;position:relative}
.k{font:600 30px/1 Geist;letter-spacing:.14em;color:#E6B24A;margin:0 0 40px}
h1{margin:0;font:600 120px/1.0 Clash;color:#F6F9FF;letter-spacing:-.02em}
h1 em{font-style:normal;color:#E6B24A}
.s{margin:48px 0 0;font:600 42px/1.32 Geist;color:#9FB0CC}
.u{display:inline-block;margin-top:60px;padding:26px 40px;border-radius:22px;background:#E6B24A;font:600 50px/1 Clash;color:#0B1018}
</style><div class="e">
<div style="margin:0 0 70px">${logo(820)}</div>
<h1>Match day ka maza, <em>auction night pe.</em></h1>
<p class="s" style="color:#F6F9FF;font-size:56px;margin-top:40px">Apna season free mein shuru karo.</p>
<p class="s">Free for up to 4 teams &amp; 40 players. Live player auctions for your league, in any of 12 sports.</p>
<div><span class="u">desiauction.in</span></div>
<div class="label">Demo auction · fictional players · points, not money</div>
</div>`;
const END_SECONDS = 2.8; // long enough to read the line and the address

function ff(args) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

async function render() {
  fs.mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const [id, , html] of BEATS) {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(WORK, `${id}.png`) });
  }
  await page.setContent(END, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(WORK, "end.png") });
  await browser.close();
}

async function main() {
  await render();

  // 1. Each beat: a still with a slow push-in (real screens, nothing redrawn).
  const clips = [];
  for (const [id, secs] of [...BEATS.map(([id, s]) => [id, s]), ["end", END_SECONDS]]) {
    const frames = Math.round(secs * 30);
    const out = path.join(WORK, `${id}.mp4`);
    ff([
      "-loop", "1", "-i", path.join(WORK, `${id}.png`), "-t", String(secs),
      "-vf",
      `scale=2160:3840,zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,` +
        (id === "end" ? "fade=in:st=0:d=0.25," : "") + "format=yuv420p,setsar=1",
      "-r", "30", "-c:v", "libx264", "-crf", "17", out,
    ]);
    clips.push(out);
  }
  const list = path.join(WORK, "list.txt");
  fs.writeFileSync(list, clips.map((c) => `file '${c}'`).join("\n"));
  const silent = path.join(WORK, "silent.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);

  // 2. Sound: the original score (score-ghar-ka.cjs), timed to the beats.
  let t = 0;
  const timeline = BEATS.map(([id, secs, , sound]) => {
    const beat = { id, start: t, secs, sound };
    t += secs;
    return beat;
  });
  const footLen = t;
  const total = footLen + 2.0 + END_SECONDS;
  const score = path.join(WORK, "score.wav");
  makeScore({ beats: timeline, footLen, total, out: score });

  // 3. Footage + the DA strike (2 s, its own sting) + the end card, joined.
  const sting = Math.round((timeline.find((b) => b.id === "b04").start + 0.3) * 1000);
  ff([
    "-i", silent, "-i", score, "-i", STRIKE, "-i", STING,
    "-filter_complex",
    `[0:v]trim=0:${footLen.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[v0];` +
      `[0:v]trim=start=${footLen.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[v2];` +
      "[2:v]scale=1080:1920,fps=30,format=yuv420p,setsar=1[v1];[v0][v1][v2]concat=n=3:v=1:a=0[v];" +
      "[1:a]aformat=sample_rates=48000:channel_layouts=stereo[m];" +
      `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(footLen * 1000)}:all=1[k];` +
      `[3:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${sting}:all=1,volume=0.8[s];` +
      `[m][k][s]amix=inputs=3:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
    "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", OUT,
  ]);
  // Cover: the payoff (SOLD).
  ff(["-i", path.join(WORK, "b01.png"), "-q:v", "3", COVER]);
  console.log(path.relative(ROOT, OUT), `${total.toFixed(1)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
