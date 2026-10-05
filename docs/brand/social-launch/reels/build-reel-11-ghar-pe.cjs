// build-reel-11-ghar-pe.cjs — "Ghar pe dekhne walon ka haal" 9:16 Reel, ~14 s.
// Series "Kagaz wali boli" 4/6 (SERIES-KAGAZ-WALI-BOLI.md). Payoff first
// (SOCIAL_CONTENT_PLAN.md §1b): frame one already asks the question.
//
// Act 1 is ANIMATED PAPER: a phone doodled on the page, a noisy live stream in
// it ("SHOR"), and the viewers' chat piling up — "awaaz nahi aa rahi", "naam
// likh do", "meri team mein kaun aaya??". Our own generic lines, no usernames,
// no real stream, league, person or place; drawn here frame by frame.
// Act 2 is the real product (capture-ghar-pe.spec.ts): a PUBLISHED points
// season, and a phone with NO account on the watch link — the player on the
// block, the live bid, SOLD, and every team's squad.
// End card: site copy, word for word — "Spectators need nothing at all." (FAQ)
// and the watch page's own line "Anyone can watch — no account needed."
// Safety: SOCIAL_CONTENT_PLAN.md §1a.
//
// usage (repo root, captures in reels/.work/ghar-pe/):
//   node docs/brand/social-launch/reels/build-reel-11-ghar-pe.cjs   (PREVIEW=1: paper stills only)

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
const CAP = path.join(__dirname, ".work/ghar-pe");
const WORK = path.join(__dirname, ".work/ghar-pe-build");
const OUT = path.join(__dirname, "reel-11-ghar-pe.mp4");
const COVER = path.join(__dirname, "reel-11-ghar-pe-cover.jpg");
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
<div class="ep">KAGAZ WALI BOLI · 4/6</div><div class="cap"><p>${caption}</p></div>
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
})) {
  const from = path.join(CAP, `${src}.png`);
  if (fs.existsSync(from)) execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", from, "-vf", `crop=${box}`, path.join(CAP, `${out}.png`)]);
}

// --- Act 1: the paper (drawn per frame) ---------------------------------------
const PAPER_SECONDS = 4.4;
const CHAT = ["awaaz nahi aa rahi 🔇", "naam likh do bhai 🙏", "meri team mein kaun aaya??", "kaun kis team mein gaya?? 😵"];
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
.pre{position:absolute;top:180px;left:150px;font-size:60px;color:#6b5a3a}
.hook{position:absolute;z-index:1;top:260px;left:150px;right:40px;font-size:100px;line-height:1.05;white-space:nowrap}
.hl{position:relative;display:inline-block}
.hl:before{content:"";position:absolute;left:-10px;right:-10px;bottom:8px;height:54px;background:#F2C94C;
  opacity:.75;z-index:-1;transform-origin:left;transform:scaleX(var(--hl,0)) rotate(-1deg)}
.phone{position:absolute;left:140px;top:500px;width:480px;height:1000px;border:9px solid #1d2433;border-radius:56px;background:#fffdf7;
  transform:rotate(-4deg);box-shadow:10px 14px 0 rgba(0,0,0,.12)}
.notch{position:absolute;left:50%;top:18px;width:110px;height:22px;margin-left:-55px;border-radius:12px;background:#1d2433}
.live{position:absolute;left:34px;top:62px;background:#C43C3C;color:#fff;font-size:40px;padding:4px 16px;border-radius:10px}
.scr{position:absolute;left:28px;right:28px;top:130px;height:520px;border:5px solid #1d2433;border-radius:20px;overflow:hidden;background:#efe6d2}
.shor{position:absolute;left:0;right:0;top:170px;text-align:center;font-size:126px;color:#C43C3C;letter-spacing:.04em}
.wave{position:absolute;top:90px;width:120px;height:300px}
.heads{position:absolute;left:0;right:0;bottom:-14px;display:flex;justify-content:center;gap:6px}
.heads i{width:50px;height:50px;border-radius:50%;border:5px solid #1d2433;background:#f3ecdc}
.vol{position:absolute;left:40px;top:690px;font-size:64px;color:#6b5a3a}
.bubble{position:absolute;left:600px;right:36px;background:#fffdf7;border:5px solid #1d2433;border-radius:28px;padding:20px 26px;
  font-size:56px;line-height:1.12;box-shadow:6px 8px 0 rgba(0,0,0,.12);opacity:0}
</style>
<div class="root">
  <div class="under"><img id="under"></div>
  <div class="paper" id="paper">
    <svg class="grain" width="1080" height="1920"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="11"/>
      <feColorMatrix values="0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .28  0 0 0 .55 0"/></filter><rect width="1080" height="1920" filter="url(#g)"/></svg>
    <div class="ep">KAGAZ WALI BOLI · <b>4/6</b></div>
    <div class="pre">Ghar pe live dekh rahe ho…</div>
    <div class="hook"><span class="hl" id="hl">kuch samajh aaya?</span> 😵</div>
    <div class="phone" id="phone"><div class="notch"></div><div class="live">● LIVE</div>
      <div class="scr" id="scr">
        <svg class="wave" style="left:6px" viewBox="0 0 60 130"><path id="w1" d="M50 10 Q10 40 50 65 Q10 90 50 120" stroke="#1d2433" stroke-width="6" fill="none"/></svg>
        <svg class="wave" style="right:6px" viewBox="0 0 60 130"><path d="M10 10 Q50 40 10 65 Q50 90 10 120" stroke="#1d2433" stroke-width="6" fill="none"/></svg>
        <div class="shor" id="shor">SHOR!!</div>
        <div class="heads">${"<i></i>".repeat(6)}</div>
      </div>
      <div class="vol" id="vol">🔊🔊🔊 ??</div>
    </div>
    ${CHAT.map((c, i) => `<div class="bubble" id="c${i}" style="top:${560 + i * 300}px">${c}</div>`).join("")}
  </div>
</div>
<script>
const clamp=(x)=>Math.max(0,Math.min(1,x));
const seg=(t,a,b)=>clamp((t-a)/(b-a));
const outBack=(x)=>{const c=1.9;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
const outCubic=(x)=>1-Math.pow(1-x,3);
window.at=(t)=>{
  hl.style.setProperty('--hl',outCubic(seg(t,0.05,0.45)));
  // the phone is on the page from frame one; the stream inside it is pure noise
  const j=(k)=>Math.sin(t*37+k)*6+Math.sin(t*23+k*2)*4;
  shor.style.transform='translate('+j(1)+'px,'+j(2)+'px) rotate('+(j(3)/3)+'deg) scale('+(1+0.06*Math.abs(Math.sin(t*16)))+')';
  scr.style.transform='translate('+(j(4)/3)+'px,'+(j(5)/3)+'px)';
  vol.style.transform='translateX('+(j(6)/2)+'px)';
  // the chat piles up, one bubble after another
  for(let i=0;i<4;i++){const a=0.7+i*0.62;const p=seg(t,a,a+0.22);const el=document.getElementById('c'+i);
    el.style.opacity=p>0?1:0;el.style.transform='translateX('+((1-outBack(p))*260)+'px) rotate('+(i%2?2:-2)+'deg)';}
  // the page tears away upward, the product is underneath
  const tear=seg(t,3.75,4.35), e=tear*tear*(3-2*tear), y=(1-e)*2050-60;
  const pts=[];for(let i=0;i<=24;i++){const x=i*45;const jj=((i*37)%7-3)*12;pts.push(x+'px '+(y+jj)+'px');}
  paper.style.clipPath=tear>0?'polygon(0 0,1080px 0,'+pts.reverse().join(',')+')':'none';
  paper.style.transform=tear>0?'rotate('+(-2*e)+'deg) translateY('+(-120*e)+'px)':'none';
};
</script>`;

// Crops of the real screens (cut above with ffmpeg, never redrawn).
const card = (name, width, radius = 28) =>
  `<div style="width:${width}px;border-radius:${radius}px;overflow:hidden;border:6px solid #2a3344;box-shadow:0 30px 90px rgba(0,0,0,.6)"><img src="${img(name)}" style="display:block;width:100%"></div>`;

// [id, seconds, html, sound]
// A phone with no account, on the watch link (full screenshots, never redrawn).
const viewer = (name, w = 600) =>
  `<div class="phone" style="width:${w}px;border-radius:44px"><img src="${img(name)}"></div>`;
const BEATS = [
  ["b01", 1.7, frame("Ek link — <em>koi account nahi.</em>", viewer("viewer-lot1-bid5")), "bid"],
  ["b02", 1.5, frame("Har bid, har <em>SOLD</em> — live.", viewer("viewer-sold1")), "sold"],
  ["b03", 1.8, frame("Kaun kis team mein? <em>Sab dikhta hai.</em>", card("viewer-squads", 900, 36)), "gavel"],
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
<h1>Spectators need <em>nothing at all.</em></h1>
<p class="s" style="color:#F6F9FF;font-size:50px;margin-top:40px">Anyone can watch — no account needed.</p>
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

  // Sound: a bell for each chat bubble, a wah at "meri team mein kaun aaya??", a
  // double bell as the last one lands, then the product beats.
  const timeline = [
    { id: "c0", start: 0.7, secs: 0.62, sound: "bid" },
    { id: "c1", start: 1.32, secs: 0.62, sound: "bid" },
    { id: "c2", start: 1.94, secs: 0.62, sound: "wah" },
    { id: "c3", start: 2.56, secs: 1.2, sound: "tie" },
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
  // Cover: the noisy phone with the whole chat piled up beside it.
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
