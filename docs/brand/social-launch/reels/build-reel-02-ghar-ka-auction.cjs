// build-reel-02-ghar-ka-auction.cjs — "Remote kiska?" 9:16 Reel, ~23 s.
//
// A family auctions the TV remote: four phones bid in a POINTS auction while
// the TV shows the big screen. Every product frame is a real screen of a real
// auction run on the local stack with fictional owners (Papa, Mummy, Beta,
// Dadi) — captured by capture-ghar-ka-auction.spec.ts (see its header). The
// tie is real too: Papa and Beta tap the same amount together, the server
// takes the first, and Beta's phone shows the product's own refusal.
//
// Safety (docs/operations/SOCIAL_CONTENT_PLAN.md §1a): no claim that is not on
// the site, no money ("points, not money"), no gambling words, no religion, no
// gender roles, no surnames, labelled "Scripted for fun · demo auction".
//
// usage (repo root, captures in reels/.work/ghar-ka/):
//   mise exec -- node docs/brand/social-launch/reels/build-reel-02-ghar-ka-auction.cjs

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAP = path.join(__dirname, ".work/ghar-ka");
const WORK = path.join(__dirname, ".work/ghar-ka-build");
const OUT = path.join(__dirname, "reel-02-ghar-ka-auction.mp4");
const COVER = path.join(__dirname, "reel-02-ghar-ka-auction-cover.jpg");
const KIT = path.join(ROOT, "docs/brand/kit");
const STRIKE = path.join(KIT, "motion/da-strike-story-1080x1920.mp4");
const STING = path.join(KIT, "sound/da-sting.wav");

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
.cap{position:absolute;left:0;right:0;top:0;height:400px;padding:0 72px 40px;display:flex;align-items:flex-end;
     background:#0B1018}
.cap p{margin:0;font:600 76px/1.06 Clash,sans-serif;letter-spacing:-.01em}
.cap em{font-style:normal;color:#E6B24A}
.who{display:inline-block;font:600 34px/1 Geist;letter-spacing:.12em;color:#0B1018;background:#E6B24A;
     padding:12px 20px;border-radius:12px;margin-bottom:22px}
.stage{position:absolute;left:0;right:0;top:420px;bottom:120px;display:flex;align-items:center;justify-content:center;gap:28px}
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

const frame = (caption, stage, opts = {}) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<div class="f"><div class="cap"><p>${opts.who ? `<span class="who">${opts.who}</span><br>` : ""}${caption}</p></div>
<div class="stage">${stage}</div>
<div class="label">Scripted for fun · demo auction · points, not money</div></div>`;

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

// [id, seconds, html, sound]
const BEATS = [
  ["b01", 2.2, frame("Match day. <em>Ek remote.</em> Chaar log. 📺", tvWith("tv-00-open", ["phone-00-Papa", "phone-00-Mummy", "phone-00-Beta", "phone-00-Dadi"])), null],
  [
    "b02",
    2.0,
    frame(
      "Ladai band. <em>Auction karo.</em> 🔨",
      `<div class="grid">${["Papa", "Mummy", "Beta", "Dadi"]
        .map((w) => `<div><p class="tag">${w}</p>${phone(`phone-00-${w}`, 470, 640)}</div>`)
        .join("")}</div>`,
    ),
    null,
  ],
  ["b03", 1.4, frame("Papa: <em>10!</em>", phone("phone-01-Papa-pick", 560), { who: "PAPA" }), "thump"],
  ["b04", 1.0, frame("Har bid, <em>TV pe live.</em> 📺", tvWith("tv-01-Papa", ["phone-01-Papa-after"])), null],
  ["b05", 1.4, frame("Mummy: <em>15!</em>", phone("phone-02-Mummy-pick", 560), { who: "MUMMY" }), "thump"],
  [
    "b06",
    2.0,
    frame(
      "Papa aur Beta — <em>ek saath 20!</em> 🤯",
      `${phone("phone-03-race-Papa", 470)}${phone("phone-03-race-Beta", 470)}`,
    ),
    "thump2",
  ],
  [
    "b07",
    2.6,
    frame(
      "Jo <em>pehle</em> pahuncha, wahi aage. Beta: 🫠",
      `<div class="phone" style="width:900px;height:1150px"><img src="${img("phone-03-race-Beta")}" style="margin-top:-640px"></div>`,
      { who: "BETA" },
    ),
    "buzz",
  ],
  ["b08", 1.4, frame("Mummy: <em>25!</em> 😤", tvWith("tv-04-Mummy", ["phone-04-Mummy-after"]), { who: "MUMMY" }), "thump"],
  ["b09", 1.8, frame("Dadi ab tak <em>chup</em> thi…", phone("phone-05-Dadi-pick", 560), { who: "DADI" }), null],
  ["b10", 1.8, frame("Dadi: <em>seedha 45!</em> 💥", tvWith("tv-05-Dadi", ["phone-05-Dadi-after"]), { who: "DADI" }), "thump"],
  [
    "b11",
    2.6,
    frame(
      "<em>SOLD</em> — Dadi. 🏆",
      `<div class="phone" style="width:760px;height:1280px"><img src="${img("phone-90-Dadi")}"></div>`,
    ),
    "sting",
  ],
];

const END = `<!doctype html><meta charset="utf-8"><style>${CSS}
.e{width:1080px;height:1920px;background:radial-gradient(120% 60% at 50% 38%,#1a1710 0%,#0B1018 62%);
   display:flex;flex-direction:column;justify-content:center;padding:0 88px 160px;position:relative}
.k{font:600 30px/1 Geist;letter-spacing:.14em;color:#E6B24A;margin:0 0 40px}
h1{margin:0;font:600 140px/1.0 Clash;color:#F6F9FF;letter-spacing:-.02em}
h1 em{font-style:normal;color:#E6B24A}
.s{margin:56px 0 0;font:600 44px/1.3 Geist;color:#9FB0CC}
.u{display:inline-block;margin-top:60px;padding:26px 40px;border-radius:22px;background:#E6B24A;font:600 50px/1 Clash;color:#0B1018}
</style><div class="e">
<p class="k">GHAR KA AUCTION · REMOTE KISKA?</p>
<h1>SOLD, without the <em>shouting.</em></h1>
<p class="s">Phones bid. The big screen shows it.<br>Free for up to 4 teams &amp; 40 players.</p>
<div><span class="u">desiauction.in</span></div>
<div class="label">Scripted for fun · demo auction · points, not money</div>
</div>`;
const END_SECONDS = 2.8;

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

  // 2. Sound: a thump per bid, a double thump on the tie, a low buzz on the
  //    refusal, the brand sting on SOLD.
  const thump = path.join(WORK, "thump.wav");
  const buzz = path.join(WORK, "buzz.wav");
  ff(["-f", "lavfi", "-i", "aevalsrc='0.9*sin(2*PI*(70-30*t)*t)*exp(-14*t)':s=48000:d=0.4", thump]);
  ff(["-f", "lavfi", "-i", "aevalsrc='0.25*sin(2*PI*110*t)*sin(2*PI*8*t)*exp(-3*t)':s=48000:d=0.6", buzz]);
  const cues = [];
  let t = 0;
  for (const [, secs, , sound] of BEATS) {
    if (sound === "thump") cues.push([thump, t + 0.25]);
    if (sound === "thump2") cues.push([thump, t + 0.25], [thump, t + 0.32]);
    if (sound === "buzz") cues.push([buzz, t + 0.15]);
    if (sound === "sting") cues.push([STING, t + 0.05]);
    t += secs;
  }
  const footLen = t;
  const total = footLen + 2.0 + END_SECONDS;
  const inputs = cues.flatMap(([file]) => ["-i", file]);
  const delays = cues.map(([, at], i) => `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(at * 1000)}:all=1[c${i}]`);
  const mixed = path.join(WORK, "foot.wav");
  ff([
    ...inputs, "-filter_complex",
    `${delays.join(";")};${cues.map((_, i) => `[c${i}]`).join("")}amix=inputs=${cues.length}:normalize=0,apad,atrim=0:${footLen.toFixed(2)}[a]`,
    "-map", "[a]", "-ar", "48000", "-ac", "2", mixed,
  ]);

  // 3. Footage + the DA strike (2 s, its own sting) + the end card, joined.
  ff([
    "-i", silent, "-i", mixed, "-i", STRIKE,
    "-f", "lavfi", "-t", String(END_SECONDS), "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex",
    `[0:v]trim=0:${footLen.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[v0];` +
      `[0:v]trim=start=${footLen.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[v2];` +
      "[2:v]scale=1080:1920,fps=30,format=yuv420p,setsar=1[v1];" +
      "[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];[2:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];" +
      "[3:a]aformat=sample_rates=48000:channel_layouts=stereo[a2];" +
      "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]",
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT,
  ]);
  // Cover: the SOLD beat.
  ff(["-i", path.join(WORK, "b11.png"), "-q:v", "3", COVER]);
  console.log(path.relative(ROOT, OUT), `${total.toFixed(1)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
