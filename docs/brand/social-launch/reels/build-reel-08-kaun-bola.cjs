// build-reel-08-kaun-bola.cjs — "Kaun bola pehle?" 9:16 Reel, ~15 s.
// Series "Kagaz wali boli" 1/6 (SERIES-KAGAZ-WALI-BOLI.md). Payoff first
// (SOCIAL_CONTENT_PLAN.md §1b): frame one already says the problem.
//
// Act 1 is ANIMATED PAPER (founder, 2026-10-05: "make paper part animated"):
// a register page where the count goes 50 → 45 → 46 → ??, then two placards
// rise at once on the same number. Nothing in it is footage — it is drawn here,
// frame by frame, so no real league, person or place appears.
// Act 2 is the real product: two phones pressed Raise at the same instant on
// the local stack (capture-kaun-bola.spec.ts) — one is accepted, the other
// reads "Someone has already bid that much or more." (real copy), and the big
// screen shows one leader, then SOLD. Fictional club and first-name players.
// Safety: SOCIAL_CONTENT_PLAN.md §1a.
//
// usage (repo root, captures in reels/.work/kaun-bola/):
//   node docs/brand/social-launch/reels/build-reel-08-kaun-bola.cjs

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
const CAP = path.join(__dirname, ".work/kaun-bola");
const WORK = path.join(__dirname, ".work/kaun-bola-build");
const OUT = path.join(__dirname, "reel-08-kaun-bola.mp4");
const COVER = path.join(__dirname, "reel-08-kaun-bola-cover.jpg");
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
const WHO_FILE = path.join(CAP, "who.txt");
const WHO = fs.existsSync(WHO_FILE) ? fs.readFileSync(WHO_FILE, "utf8").trim() : "refused=B"; // refused=A | refused=B
const REFUSED = WHO === "refused=A" ? "A" : "B";
const WON = REFUSED === "A" ? "B" : "A";

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
<div class="ep">KAGAZ WALI BOLI · 1/6</div><div class="cap"><p>${caption}</p></div>
<div class="stage">${stage}</div><div class="label">Demo auction · fictional players</div></div>`;
// A phone cropped to its top (the lot, the bid, the toast) — `offset` scrolls the shot.
const phone = (name, w, h, tag, offset = 0) => `<div><p class="tag">${tag}</p>
  <div class="phone" style="width:${w}px;height:${h}px"><img src="${img(name)}" style="margin-top:-${offset}px"></div></div>`;
const pair = (a, b, h, offset) => `<div style="display:flex;gap:30px">
  ${phone(a, 470, h, "OWNER <b>A</b>", offset)}${phone(b, 470, h, "OWNER <b>B</b>", offset)}</div>`;
const tvOver = (tv, phones) => `<div style="display:flex;flex-direction:column;align-items:center;gap:34px">
  <div class="tv"><img src="${img(tv)}"></div>${phones}</div>`;

const PHONE_CROP = Number(process.env["PHONE_CROP"] ?? 1017); // px at 470 wide
const PHONE_OFFSET = Number(process.env["PHONE_OFFSET"] ?? 0);
const shotOf = (who, which) => (which === "before" ? `phone${who}-before` : who === REFUSED ? "refused" : "leading");

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
  font-family:"Marker Felt","Noteworthy","Chalkboard SE",sans-serif;color:#1d2433;
  box-shadow:0 0 0 2px rgba(0,0,0,.05)}
.grain{position:absolute;inset:0;opacity:.35;mix-blend-mode:multiply}
.ep{position:absolute;top:70px;left:150px;font-size:40px;letter-spacing:.06em;color:#6b5a3a;transform:rotate(-2deg)}
.ep b{color:#C43C3C}
.hook{position:absolute;z-index:1;top:210px;left:150px;right:70px;font-size:118px;line-height:1.05}
.hook .hl{position:relative;display:inline-block}
.hook .hl:before{content:"";position:absolute;left:-10px;right:-10px;bottom:6px;height:52px;background:#F2C94C;
  opacity:.75;z-index:-1;transform-origin:left;transform:scaleX(var(--hl,0)) rotate(-1deg)}
.nums{position:absolute;top:640px;left:150px;right:60px;height:220px;display:flex;align-items:center;gap:44px;font-size:180px}
.n{position:relative;display:inline-block;opacity:0}
.n svg{position:absolute;left:-14px;top:30px;width:calc(100% + 28px);height:150px;overflow:visible}
.q{color:#C43C3C}
.cap2{position:absolute;top:900px;left:150px;font-size:76px;color:#1d2433;opacity:0}
.stick{position:absolute;bottom:-40px;width:26px;height:620px;background:linear-gradient(90deg,#9a6b3c,#c4925c,#9a6b3c);border-radius:8px}
.board{position:absolute;bottom:520px;left:50%;width:400px;height:300px;margin-left:-200px;background:#fffdf7;border:6px solid #1d2433;
  border-radius:18px;box-shadow:0 18px 0 rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;justify-content:center}
.board i{font-style:normal;font-size:44px;color:#6b5a3a;letter-spacing:.08em}
.board b{font-weight:400;font-size:190px;line-height:.9}
.placard{position:absolute;bottom:0;width:440px;height:1000px}
.bang{position:absolute;top:1130px;left:0;right:0;text-align:center;font-size:150px;color:#C43C3C;opacity:0}
</style>
<div class="root">
  <div class="under"><img id="under"></div>
  <div class="paper" id="paper">
    <svg class="grain" width="1080" height="1920"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/>
      <feColorMatrix values="0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .28  0 0 0 .55 0"/></filter><rect width="1080" height="1920" filter="url(#g)"/></svg>
    <div class="ep">KAGAZ WALI BOLI · <b>1/6</b></div>
    <div class="hook">Ruko…<br><span class="hl">Kaun bola pehle?</span></div>
    <div class="nums">
      <span class="n" id="n50">50<svg viewBox="0 0 100 40" preserveAspectRatio="none"><path id="s50" d="M2 30 C30 22,60 14,98 8" stroke="#C43C3C" stroke-width="7" fill="none" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg></span>
      <span class="n" id="n45">45</span>
      <span class="n" id="n46">46</span>
      <span class="n q" id="nq">??</span>
    </div>
    <div class="cap2" id="cap2">Do takhti. <u>Ek</u> number.</div>
    <div class="bang" id="bang">!!</div>
    <div class="placard" id="pa" style="left:40px"><div class="stick" style="left:207px"></div><div class="board"><i>TEAM A</i><b>46</b></div></div>
    <div class="placard" id="pb" style="right:40px"><div class="stick" style="left:207px"></div><div class="board"><i>TEAM B</i><b>46</b></div></div>
  </div>
</div>
<script>
const clamp=(x)=>Math.max(0,Math.min(1,x));
const seg=(t,a,b)=>clamp((t-a)/(b-a));
const outBack=(x)=>{const c=1.9;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
const outCubic=(x)=>1-Math.pow(1-x,3);
const slam=(el,t,a,rot)=>{const p=seg(t,a,a+0.22);el.style.opacity=p>0?1:0;
  el.style.transform='scale('+(1.6-0.6*outBack(p))+') rotate('+rot+'deg)';};
window.at=(t)=>{
  // the highlighter sweeps under the hook in the first half-second
  document.querySelector('.hook .hl').style.setProperty('--hl',outCubic(seg(t,0.05,0.5)));
  slam(n50,t,0.0,-4);
  slam(n45,t,0.9,3);
  document.getElementById('s50').style.strokeDashoffset=1-outCubic(seg(t,0.95,1.25));
  slam(n46,t,1.35,-2);
  slam(nq,t,1.75,6);
  nq.style.transform+=' translateY('+(Math.sin(t*18)*6*seg(t,1.9,2.4))+'px)';
  // two placards rise TOGETHER — same frame, same number
  const up=outBack(seg(t,2.35,2.85));
  const sway=Math.sin((t-2.85)*9)*3*seg(t,2.85,3.0);
  pa.style.transform='translateY('+((1-up)*1000)+'px) rotate('+(-7+sway)+'deg)';
  pb.style.transform='translateY('+((1-up)*1000)+'px) rotate('+(7-sway)+'deg)';
  cap2.style.opacity=seg(t,2.7,2.9);
  bang.style.opacity=seg(t,2.85,2.95)*(1-seg(t,3.6,3.7));
  bang.style.transform='scale('+(1+0.25*Math.abs(Math.sin(t*14)))+')';
  // the page tears away upward, the product is underneath
  const tear=seg(t,3.75,4.35), e=tear*tear*(3-2*tear), y=(1-e)*2050-60;
  const pts=[];for(let i=0;i<=24;i++){const x=i*45;const j=((i*37)%7-3)*12;pts.push(x+'px '+(y+j)+'px');}
  paper.style.clipPath=tear>0?'polygon(0 0,1080px 0,'+pts.reverse().join(',')+')':'none';
  paper.style.transform=tear>0?'rotate('+(-2*e)+'deg) translateY('+(-120*e)+'px)':'none';
};
</script>`;

// [id, seconds, html, sound]
// The refusal is the app's own sentence (packages/core/src/auction-copy.ts,
// BELOW_CURRENT), set large over the phone that got it so it reads on mute.
const callout = (text) => `<div style="position:absolute;left:50%;top:44%;transform:translate(-50%,-50%) rotate(-2deg);width:860px;
  background:#2a1215;border:4px solid #E5484D;border-radius:30px;padding:30px 38px;box-shadow:0 30px 80px rgba(0,0,0,.7);
  font:600 46px/1.25 Geist;color:#F6F9FF;z-index:3"><span style="display:block;font-size:28px;letter-spacing:.12em;color:#FF8A8E;margin-bottom:12px">OWNER ${REFUSED} KO JAWAB</span>“${text}”</div>`;
const tvWide = (name) => `<div class="tv" style="width:1000px"><img src="${img(name)}"></div>`;

// [id, seconds, html, sound]
const BEATS = [
  ["b01", 1.4, frame("Ab: dono ne <em>ek saath</em> dabaya.", pair(shotOf("A", "before"), shotOf("B", "before"), PHONE_CROP, PHONE_OFFSET)), "tie"],
  ["b02", 2.2, frame("Server ne <em>ek hi</em> maana. ✅",
    `<div style="position:relative">${pair(shotOf("A", "after"), shotOf("B", "after"), PHONE_CROP, PHONE_OFFSET)
      .replace("OWNER <b>A</b>", `OWNER <b>A</b> · ${WON === "A" ? "LEADING" : "REFUSED"}`)
      .replace("OWNER <b>B</b>", `OWNER <b>B</b> · ${WON === "B" ? "LEADING" : "REFUSED"}`)}
      ${callout("Someone has already bid that much or more.")}</div>`), "gavel"],
  ["b03", 1.7, frame("Big screen pe: <em>SOLD.</em><br>Bina jhagde.", tvWide("tv-sold-crop")), "sold"],
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
<h1>The server checks every bid, <em>not the loudest voice.</em></h1>
<p class="s">Free for up to 4 teams &amp; 40 players. Live player auctions for your league.</p>
<div><span class="u">desiauction.in</span></div>
<div class="label">Demo auction · fictional players</div>
</div>`;
const END_SECONDS = 3.2;

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

  // Sound: the paper act's cues (50, 45, a wah at "??", the double bell as both
  // placards rise), then the product beats.
  const timeline = [
    { id: "p50", start: 0.0, secs: 0.9, sound: "bid" },
    { id: "p45", start: 0.9, secs: 0.85, sound: "bid" },
    { id: "pq", start: 1.75, secs: 0.6, sound: "wah" },
    { id: "ptie", start: 2.35, secs: 2.05, sound: "tie" },
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
  // Cover: the paper at its loudest — both placards up on the same number.
  ff(["-i", path.join(WORK, "paper/p0090.png"), "-q:v", "3", COVER]);
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
