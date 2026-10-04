// build-reel-10-bolna.cjs — "Bolna kisi ne?" 9:16 Reel, ~14 s.
// Series "Kagaz wali boli" 3/6 (SERIES-KAGAZ-WALI-BOLI.md). Payoff first
// (SOCIAL_CONTENT_PLAN.md §1b): frame one already asks the question.
//
// Act 1 is ANIMATED PAPER: "Bolna kisi ne?" asked three times, louder each
// time, then "ek baar… ek baar…" stacking down the page while a doodled clock
// spins — the dead air of a paper auction. The band drops out under it. Drawn
// here frame by frame — no footage, no real league, person or place.
// Act 2 is the real product in a points season on the local stack
// (capture-bolna.spec.ts): nobody bids, the big screen's clock runs 12 → 3 → 2
// → 1, and at zero the ENGINE closes the lot itself (engine-core.ts tick →
// _TimerClose) — SOLD to the highest bid, with no one touching the gavel.
// End card: site copy, word for word — "SOLD, without the shouting."
// Safety: SOCIAL_CONTENT_PLAN.md §1a.
//
// usage (repo root, captures in reels/.work/bolna/):
//   node docs/brand/social-launch/reels/build-reel-10-bolna.cjs   (PREVIEW=1: paper stills only)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const { makeScore } = require("./score-ghar-ka.cjs");

const ROOT = path.resolve(__dirname, "../../../..");
const WEB = fs.existsSync(path.join(ROOT, "apps/web/node_modules/@playwright/test"))
  ? ROOT
  : path.resolve(ROOT, "../desiauction"); // a docs-only worktree borrows the main checkout's tools
const { chromium } = createRequire(path.join(WEB, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAP = path.join(__dirname, ".work/bolna");
const WORK = path.join(__dirname, ".work/bolna-build");
const OUT = path.join(__dirname, "reel-10-bolna.mp4");
const COVER = path.join(__dirname, "reel-10-bolna-cover.jpg");
const KIT = path.join(ROOT, "docs/brand/kit");
const STRIKE = path.join(KIT, "motion/da-strike-story-1080x1920.mp4");
const STING = path.join(KIT, "sound/da-sting.wav");
const LOCKUP = path.join(KIT, "png/lockup-dark-2400.png");

const b64 = (file) => fs.readFileSync(file).toString("base64");
const font = (file) => `url("data:font/woff2;base64,${b64(file)}") format("woff2")`;
const img = (name) => {
  const file = path.join(CAP, `${name}.png`);
  return fs.existsSync(file) ? `data:image/png;base64,${b64(file)}` : ""; // PREVIEW runs before the capture
};
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  WEB,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);
// --- Act 2: real screens (same frame language as reel 06) ---------------------
const CSS = `
@font-face{font-family:Clash;src:${font(CLASH)};font-weight:600}
@font-face{font-family:Geist;src:${font(GEIST)};font-weight:600}
*{box-sizing:border-box}html,body{margin:0}
.f{width:1080px;height:1920px;background:radial-gradient(120% 70% at 50% 45%,#161b26 0%,#0B1018 65%);
   position:relative;overflow:hidden;font-family:Geist,sans-serif;color:#F6F9FF}
.cap{position:absolute;left:0;right:0;top:0;height:430px;padding:0 72px 34px;display:flex;align-items:flex-end;background:#0B1018}
.cap p{margin:0;font:600 78px/1.06 Clash,sans-serif;letter-spacing:-.01em}
.cap em{font-style:normal;color:#E6B24A}
.ep{position:absolute;top:70px;right:72px;font:600 28px/1 Geist;letter-spacing:.14em;color:#9FB0CC}
.stage{position:absolute;left:0;right:0;top:450px;bottom:110px;display:flex;align-items:center;justify-content:center}
.phone{border-radius:40px;border:6px solid #2a3344;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6);background:#0B1018;position:relative}
.phone img{display:block;width:100%}
.tag{font:600 30px/1 Geist;letter-spacing:.12em;margin:0 0 14px 8px;color:#9FB0CC}
.tag b{color:#E6B24A}
.tv{width:960px;border-radius:22px;border:10px solid #1c2230;box-shadow:0 30px 90px rgba(0,0,0,.65);overflow:hidden}
.tv img{display:block;width:100%}
.label{position:absolute;left:0;right:0;bottom:44px;text-align:center;font:600 26px/1 Geist;letter-spacing:.06em;color:#6f7f99}
`;
const logo = (w) => `<img src="data:image/png;base64,${b64(LOCKUP)}" style="width:${w}px;display:block">`;
const frame = (caption, stage) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<div class="f"><div style="position:absolute;top:58px;left:72px;z-index:2">${logo(300)}</div>
<div class="ep">KAGAZ WALI BOLI · 3/6</div><div class="cap"><p>${caption}</p></div>
<div class="stage">${stage}</div><div class="label">Demo auction · fictional players · points, not money</div></div>`;
// A phone cropped to its top (the lot, the bid, the toast) — `offset` scrolls the shot.
const phone = (name, w, h, tag, offset = 0) => `<div><p class="tag">${tag}</p>
  <div class="phone" style="width:${w}px;height:${h}px"><img src="${img(name)}" style="margin-top:-${offset}px"></div></div>`;
const pair = (a, b, h, offset) => `<div style="display:flex;gap:30px">
  ${phone(a, 470, h, "OWNER <b>A</b>", offset)}${phone(b, 470, h, "OWNER <b>B</b>", offset)}</div>`;
const tvOver = (tv, phones) => `<div style="display:flex;flex-direction:column;align-items:center;gap:34px">
  <div class="tv"><img src="${img(tv)}"></div>${phones}</div>`;

// Cut the crops before any frame reads them (img() inlines at definition time).
for (const [out, [src, box]] of Object.entries({
  ...Object.fromEntries(["12", "03", "02", "01"].flatMap((t) => [
    [`block-${t}`, [`board-t${t}`, "1646:800:640:571"]],
    [`clock-${t}`, [`board-t${t}`, "380:300:2725:1085"]],
  ])),
  "sold": ["stage-sold", "790:940:1207:339"],
})) {
  const from = path.join(CAP, `${src}.png`);
  if (fs.existsSync(from)) execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", from, "-vf", `crop=${box}`, path.join(CAP, `${out}.png`)]);
}

// --- Act 1: the paper (drawn per frame) ---------------------------------------
const PAPER_SECONDS = 4.4;
const PAPER = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0}
.root{width:1080px;height:1920px;position:relative;overflow:hidden;background:#0B1018}
.under{position:absolute;inset:0}
.under img{width:100%;height:100%;display:block}
.paper{position:absolute;inset:0;background:#F3ECDC;
  background-image:
    repeating-linear-gradient(180deg,transparent 0 86px,rgba(64,110,170,.22) 86px 89px),
    linear-gradient(90deg,transparent 0 118px,rgba(196,60,60,.35) 118px 121px,transparent 121px);
  font-family:"Marker Felt","Noteworthy","Chalkboard SE",sans-serif;color:#1d2433}
.grain{position:absolute;inset:0;opacity:.35;mix-blend-mode:multiply}
.ep{position:absolute;top:70px;left:150px;font-size:40px;letter-spacing:.06em;color:#6b5a3a;transform:rotate(-2deg)}
.ep b{color:#C43C3C}
.ask{position:absolute;left:150px;white-space:nowrap;opacity:0;transform-origin:left center}
.a1{top:180px;font-size:104px}
.a2{top:330px;font-size:122px}
.a3{top:500px;font-size:118px;color:#C43C3C}
.hl{position:relative;display:inline-block}
.hl:before{content:"";position:absolute;left:-10px;right:-10px;bottom:8px;height:54px;background:#F2C94C;
  opacity:.75;z-index:-1;transform-origin:left;transform:scaleX(var(--hl,0)) rotate(-1deg)}
.a1{z-index:1}
.eb{position:absolute;left:150px;font-size:76px;white-space:nowrap;clip-path:inset(0 100% 0 0);color:#3b4252}
.later{position:absolute;right:70px;top:1700px;font-size:54px;color:#6b5a3a;opacity:0;transform:rotate(-3deg)}
.clock{position:absolute;right:80px;top:880px;width:260px;height:260px;opacity:0}
.yawn{position:absolute;right:120px;top:1200px;font-size:150px;opacity:0}
</style>
<div class="root">
  <div class="under"><img id="under"></div>
  <div class="paper" id="paper">
    <svg class="grain" width="1080" height="1920"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="9"/>
      <feColorMatrix values="0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .28  0 0 0 .55 0"/></filter><rect width="1080" height="1920" filter="url(#g)"/></svg>
    <div class="ep">KAGAZ WALI BOLI · <b>3/6</b></div>
    <div class="ask a1" id="a1"><span class="hl" id="hl">Bolna kisi ne?</span></div>
    <div class="ask a2" id="a2">Bolna kisi ne??</div>
    <div class="ask a3" id="a3">BOLNA KISI NE???</div>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="eb" id="e${i}" style="top:${880 + i * 118}px;opacity:${1 - i * 0.1}">Ek baar…${i === 5 ? " 😴" : ""}</div>`).join("")}
    <svg class="clock" id="clock" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="#fffdf7" stroke="#1d2433" stroke-width="5"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => `<line x1="50" y1="11" x2="50" y2="17" stroke="#1d2433" stroke-width="3" transform="rotate(${k * 30} 50 50)"/>`).join("")}
      <line id="hand" x1="50" y1="50" x2="50" y2="16" stroke="#C43C3C" stroke-width="5" stroke-linecap="round"/>
      <line id="hand2" x1="50" y1="50" x2="50" y2="28" stroke="#1d2433" stroke-width="6" stroke-linecap="round"/>
      <circle cx="50" cy="50" r="4" fill="#1d2433"/></svg>
    <div class="later" id="later">(10 minute baad…)</div>
  </div>
</div>
<script>
const clamp=(x)=>Math.max(0,Math.min(1,x));
const seg=(t,a,b)=>clamp((t-a)/(b-a));
const outBack=(x)=>{const c=1.9;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
const outCubic=(x)=>1-Math.pow(1-x,3);
const slam=(el,t,a,rot)=>{const p=seg(t,a,a+0.2);el.style.opacity=p>0?1:0;
  el.style.transform='scale('+(1.5-0.5*outBack(p))+') rotate('+rot+'deg)';};
window.at=(t)=>{
  slam(a1,t,-0.2,-2); // fully on the page from frame one (the hook is the payoff)
  hl.style.setProperty('--hl',outCubic(seg(t,0.1,0.5)));
  slam(a2,t,0.6,2);
  slam(a3,t,1.2,-3);
  a3.style.transform+=' translateX('+(Math.sin(t*30)*5*seg(t,1.4,1.8)*(1-seg(t,1.8,2.0)))+'px)';
  // the room goes quiet: "ek baar…" written slower and slower down the page
  for(let i=0;i<6;i++){const a=1.85+i*0.27;
    document.getElementById('e'+i).style.clipPath='inset(0 '+(100-100*seg(t,a,a+0.24))+'% 0 0)';}
  clock.style.opacity=seg(t,1.85,2.05);
  hand.setAttribute('transform','rotate('+(t>1.85?(t-1.85)*720:0)+' 50 50)');
  hand2.setAttribute('transform','rotate('+(t>1.85?(t-1.85)*60:0)+' 50 50)');
  later.style.opacity=seg(t,3.2,3.4);
  // the page tears away upward, the product is underneath
  const tear=seg(t,3.75,4.35), e=tear*tear*(3-2*tear), y=(1-e)*2050-60;
  const pts=[];for(let i=0;i<=24;i++){const x=i*45;const j=((i*37)%7-3)*12;pts.push(x+'px '+(y+j)+'px');}
  paper.style.clipPath=tear>0?'polygon(0 0,1080px 0,'+pts.reverse().join(',')+')':'none';
  paper.style.transform=tear>0?'rotate('+(-2*e)+'deg) translateY('+(-120*e)+'px)':'none';
};
</script>`;

// Crops of the real screens (cut above with ffmpeg, never redrawn).
const card = (name, width, radius = 28) =>
  `<div style="width:${width}px;border-radius:${radius}px;overflow:hidden;border:6px solid #2a3344;box-shadow:0 30px 90px rgba(0,0,0,.6)"><img src="${img(name)}" style="display:block;width:100%"></div>`;

// [id, seconds, html, sound]
// The countdown is four real board frames (12, 3, 2, 1 seconds) — the clock
// turns red near zero on its own; then the stage at zero.
const ticking = (t) => `<div style="display:flex;flex-direction:column;align-items:center;gap:30px">
  ${card(`block-${t}`, 1000, 24)}${card(`clock-${t}`, 480, 24)}</div>`;
const TICK = "Koi nahi poochta. <em>Ghadi chalti hai.</em> ⏱️";
const BEATS = [
  ["b01", 1.2, frame(TICK, ticking("12")), "bid"],
  ["b02", 0.5, frame(TICK, ticking("03")), "bid"],
  ["b03", 0.5, frame(TICK, ticking("02")), "bid"],
  ["b04", 0.5, frame(TICK, ticking("01")), "bid"],
  ["b05", 1.9, frame("Zero pe — <em>SOLD.</em><br>Apne aap.", card("sold", 720, 36)), "sold"],
];

const END = `<!doctype html><meta charset="utf-8"><style>${CSS}
.e{width:1080px;height:1920px;background:radial-gradient(120% 60% at 50% 38%,#1a1710 0%,#0B1018 62%);
   display:flex;flex-direction:column;justify-content:center;padding:0 88px 160px;position:relative}
h1{margin:0;font:600 104px/1.02 Clash;color:#F6F9FF;letter-spacing:-.02em}
h1 em{font-style:normal;color:#E6B24A}
.s{margin:48px 0 0;font:600 42px/1.32 Geist;color:#9FB0CC}
.u{display:inline-block;margin-top:60px;padding:26px 40px;border-radius:22px;background:#E6B24A;font:600 50px/1 Clash;color:#0B1018}
</style><div class="e">
<div style="margin:0 0 70px">${logo(820)}</div>
<h1>SOLD, <em>without the shouting.</em></h1>
<p class="s">Free for up to 4 teams &amp; 40 players. Points or rupees.</p>
<div><span class="u">desiauction.in</span></div>
<div class="label">Demo auction · fictional players · points, not money</div>
</div>`;
const END_SECONDS = 3.0;

function ff(args) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

async function render() {
  fs.mkdirSync(path.join(WORK, "paper"), { recursive: true });
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
  // Act 1, frame by frame; the first product frame sits under the tearing page.
  await page.setContent(PAPER, { waitUntil: "load" });
  await page.evaluate((src) => {
    document.getElementById("under").src = src;
  }, `data:image/png;base64,${b64(path.join(WORK, "b01.png"))}`);
  await page.evaluate(() => document.fonts.ready);
  const frames = Math.round(PAPER_SECONDS * 30);
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate((t) => window.at(t), i / 30);
    await page.screenshot({ path: path.join(WORK, "paper", `p${String(i).padStart(4, "0")}.png`) });
  }
  await browser.close();
}

async function main() {
  await render();
  const clips = [];
  const paper = path.join(WORK, "paper.mp4");
  ff(["-framerate", "30", "-i", path.join(WORK, "paper/p%04d.png"), "-vf", "format=yuv420p,setsar=1", "-r", "30", "-c:v", "libx264", "-crf", "17", paper]);
  clips.push(paper);
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

  // Sound: a bell on each "bolna kisi ne?", then the band drops out under "ek
  // baar…" (heartbeat + riser), a hit as the page tears, then the countdown bells.
  const timeline = [
    { id: "p1", start: 0.0, secs: 0.6, sound: "bid" },
    { id: "p2", start: 0.6, secs: 0.6, sound: "bid" },
    { id: "p3", start: 1.2, secs: 0.6, sound: "bid" },
    { id: "pquiet", start: 1.85, secs: 1.9, sound: "wait" }, // the band stops: dead air
    { id: "pback", start: PAPER_SECONDS, secs: 0.1, sound: "dadi" }, // the page tears, the band is back
  ];
  let t = PAPER_SECONDS;
  for (const [id, secs, , sound] of BEATS) {
    timeline.push({ id, start: t, secs, sound });
    t += secs;
  }
  const footLen = t;
  const total = footLen + 2.0 + END_SECONDS;
  const score = path.join(WORK, "score.wav");
  makeScore({ beats: timeline, footLen, total, out: score });

  const sting = Math.round((timeline.find((b) => b.id === "b05").start + 0.3) * 1000);
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
  // Cover: the paper at its emptiest — three asks, the "ek baar" column, the clock.
  ff(["-i", path.join(WORK, "paper/p0105.png"), "-q:v", "3", COVER]);
  console.log(path.relative(ROOT, OUT), `${total.toFixed(1)} s`);
}

// PREVIEW=1: a few stills of the paper act alone (no captures needed).
async function preview() {
  const dir = path.join(WORK, "preview");
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.setContent(PAPER, { waitUntil: "load" });
  for (const t of [0, 0.5, 1.3, 2.0, 3.0, 4.0]) {
    await page.evaluate((x) => window.at(x), t);
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(1)}.png`), scale: "css" });
  }
  await browser.close();
  console.log(dir);
}

(process.env["PREVIEW"] ? preview() : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
