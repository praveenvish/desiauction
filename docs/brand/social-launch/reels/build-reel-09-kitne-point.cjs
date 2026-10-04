// build-reel-09-kitne-point.cjs — "Bhai, kitne point bache?" 9:16 Reel, ~14 s.
// Series "Kagaz wali boli" 2/6 (SERIES-KAGAZ-WALI-BOLI.md). Payoff first
// (SOCIAL_CONTENT_PLAN.md §1b): frame one already asks the question.
//
// Act 1 is ANIMATED PAPER: a hisaab page where three teams' points are written
// out by hand, the totals get struck and rewritten, and the room starts asking
// "kitne bache?". Drawn here frame by frame — no footage, no real league,
// person or place. Act 2 is the real product in a POINTS season on the local
// stack (capture-kitne-point.spec.ts): the big screen's board with every team's
// points remaining, spent and squad, and an owner's own purse on their phone.
// Site copy on the end card, word for word: "No more “bhai, hisaab?”" and
// "Every squad and what it paid, from the auction's record." Safety: §1a.
//
// usage (repo root, captures in reels/.work/kitne-point/):
//   node docs/brand/social-launch/reels/build-reel-09-kitne-point.cjs   (PREVIEW=1: paper stills only)

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
const CAP = path.join(__dirname, ".work/kitne-point");
const WORK = path.join(__dirname, ".work/kitne-point-build");
const OUT = path.join(__dirname, "reel-09-kitne-point.mp4");
const COVER = path.join(__dirname, "reel-09-kitne-point-cover.jpg");
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
<div class="ep">KAGAZ WALI BOLI · 2/6</div><div class="cap"><p>${caption}</p></div>
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
  "team-1": ["board-final", "983:573:96:1044"],
  "team-2": ["board-final", "984:573:1108:1044"],
  "team-3": ["board-final", "983:573:2121:1044"],
  "lot3-block": ["board-3-live", "1326:747:665:604"],
  "lot3-after": ["board-3-sold", "981:552:96:1030"],
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
.pre{position:absolute;top:190px;left:150px;font-size:58px;color:#6b5a3a}
.hook{position:absolute;z-index:1;top:270px;left:150px;right:60px;font-size:116px;line-height:1.05}
.hook .hl{position:relative;display:inline-block}
.hook .hl:before{content:"";position:absolute;left:-10px;right:-10px;bottom:6px;height:52px;background:#F2C94C;
  opacity:.75;z-index:-1;transform-origin:left;transform:scaleX(var(--hl,0)) rotate(-1deg)}
.cols{position:absolute;top:700px;left:150px;right:50px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.col h3{margin:0 0 10px;font-weight:400;font-size:52px;color:#6b5a3a;letter-spacing:.04em}
.w{display:block;font-size:76px;line-height:1.14;white-space:nowrap;clip-path:inset(0 100% 0 0)}
.tot{position:relative;display:inline-block;border-top:5px solid #1d2433;padding-top:4px;margin-top:6px}
.tot svg{position:absolute;left:-10px;top:24px;width:calc(100% + 20px);height:70px;overflow:visible}
.re{display:block;font-size:84px;color:#C43C3C;opacity:0}
.bub{position:absolute;background:#fffdf7;border:5px solid #1d2433;border-radius:40px;padding:22px 34px;font-size:64px;
  box-shadow:0 12px 0 rgba(0,0,0,.12);opacity:0;white-space:nowrap}
.bub:after{content:"";position:absolute;bottom:-34px;width:40px;height:40px;background:#fffdf7;border-right:5px solid #1d2433;
  border-bottom:5px solid #1d2433;transform:rotate(45deg) skew(10deg,10deg)}
.b1{left:110px;top:1330px}.b1:after{left:70px}
.b2{right:70px;top:1500px}.b2:after{right:80px}
.b3{left:200px;top:1680px}.b3:after{left:120px}
</style>
<div class="root">
  <div class="under"><img id="under"></div>
  <div class="paper" id="paper">
    <svg class="grain" width="1080" height="1920"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="5"/>
      <feColorMatrix values="0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .28  0 0 0 .55 0"/></filter><rect width="1080" height="1920" filter="url(#g)"/></svg>
    <div class="ep">KAGAZ WALI BOLI · <b>2/6</b></div>
    <div class="pre">Auction ke 2 ghante baad…</div>
    <div class="hook">Bhai, <span class="hl">kitne point bache?</span></div>
    <div class="cols">
      ${[["TEAM A", "1000", "−30", "−25", "945", "935?"], ["TEAM B", "1000", "−40", "−5", "955", "945?"], ["TEAM C", "1000", "−20", "−35", "945", "955?"]]
        .map(([h, a, b, c, tot, re], k) => `<div class="col"><h3>${h}</h3>
          <span class="w" id="w${k}0">${a}</span><span class="w" id="w${k}1">${b}</span><span class="w" id="w${k}2">${c}</span>
          <span class="w" id="w${k}3"><span class="tot">${tot}<svg viewBox="0 0 100 30" preserveAspectRatio="none"><path id="x${k}" d="M2 24 C30 18,60 10,98 4" stroke="#C43C3C" stroke-width="7" fill="none" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg></span></span>
          <span class="re" id="r${k}">${re}</span></div>`)
        .join("")}
    </div>
    <div class="bub b1" id="bb1">Kitne bache?? 😩</div>
    <div class="bub b2" id="bb2">945 ya 935?</div>
    <div class="bub b3" id="bb3">Copy dikhao! 📒</div>
  </div>
</div>
<script>
const clamp=(x)=>Math.max(0,Math.min(1,x));
const seg=(t,a,b)=>clamp((t-a)/(b-a));
const outBack=(x)=>{const c=1.9;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
const outCubic=(x)=>1-Math.pow(1-x,3);
const pop=(el,t,a,rot)=>{const p=seg(t,a,a+0.2);el.style.opacity=p>0?1:0;
  el.style.transform='scale('+(0.4+0.6*outBack(p))+') rotate('+rot+'deg)';};
window.at=(t)=>{
  document.querySelector('.hook .hl').style.setProperty('--hl',outCubic(seg(t,0.05,0.5)));
  // the pen writes each team's column, row by row, across the three teams
  for(let r=0;r<4;r++)for(let k=0;k<3;k++){
    const a=0.25+r*0.32+k*0.09;
    document.getElementById('w'+k+r).style.clipPath='inset(0 '+(100-100*seg(t,a,a+0.16))+'% 0 0)';
  }
  // every total gets struck and rewritten — nobody agrees
  for(let k=0;k<3;k++){
    const a=1.75+k*0.12;
    document.getElementById('x'+k).style.strokeDashoffset=1-outCubic(seg(t,a,a+0.18));
    const re=document.getElementById('r'+k);re.style.opacity=seg(t,a+0.18,a+0.3);
    re.style.transform='rotate('+(k%2?4:-4)+'deg) translateX('+(Math.sin(t*20+k)*4*seg(t,a+0.3,a+0.6))+'px)';
  }
  pop(bb1,t,2.35,-3);pop(bb2,t,2.75,3);pop(bb3,t,3.15,-2);
  // the page tears away upward, the product is underneath
  const tear=seg(t,3.75,4.35), e=tear*tear*(3-2*tear), y=(1-e)*2050-60;
  const pts=[];for(let i=0;i<=24;i++){const x=i*45;const j=((i*37)%7-3)*12;pts.push(x+'px '+(y+j)+'px');}
  paper.style.clipPath=tear>0?'polygon(0 0,1080px 0,'+pts.reverse().join(',')+')':'none';
  paper.style.transform=tear>0?'rotate('+(-2*e)+'deg) translateY('+(-120*e)+'px)':'none';
};
</script>`;

// Crops of the real board (cut above with ffmpeg, never redrawn).
const card = (name, width, radius = 28) =>
  `<div style="width:${width}px;border-radius:${radius}px;overflow:hidden;border:6px solid #2a3344;box-shadow:0 30px 90px rgba(0,0,0,.6)"><img src="${img(name)}" style="display:block;width:100%"></div>`;
const stack = (names, width) =>
  `<div style="display:flex;flex-direction:column;gap:22px">${names.map((n) => card(n, width, 24)).join("")}</div>`;

// [id, seconds, html, sound]
const BEATS = [
  ["b01", 1.6, frame("Har team ke points — <em>sabke saamne.</em>", stack(["team-1", "team-2", "team-3"], 700)), "gavel"],
  ["b02", 1.2, frame("50 pts pe <em>SOLD…</em>", card("lot3-block", 900)), "bid"],
  ["b03", 1.5, frame("…purse <em>apne aap</em> update. ✅", card("lot3-after", 900)), "sold"],
  ["b04", 1.3, frame("Owner ke phone pe bhi: <em>apna purse.</em>", card("purse-0", 960, 36)), null],
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
<h1>No more <em>“bhai, hisaab?”</em></h1>
<p class="s" style="color:#F6F9FF;font-size:50px;margin-top:40px">Every squad and what it paid, from the auction's record.</p>
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

  // Sound: the paper act's cues (a bell as the pen writes, a wah as every total
  // is struck, a double bell as the room starts asking), then the product beats.
  const timeline = [
    { id: "pw", start: 0.25, secs: 1.4, sound: "bid" },
    { id: "px", start: 1.75, secs: 0.6, sound: "wah" },
    { id: "pb", start: 2.35, secs: 1.4, sound: "tie" },
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

  const sting = Math.round((timeline.find((b) => b.id === "b03").start + 0.3) * 1000);
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
  // Cover: the paper at its loudest — every total struck, every bubble up.
  ff(["-i", path.join(WORK, "paper/p0108.png"), "-q:v", "3", COVER]);
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
