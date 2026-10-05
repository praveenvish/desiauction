// build-carousel-13-recap.cjs — "Kagaz wali boli vs DesiAuction", an 8-slide
// Instagram carousel (1080×1350). Series "Kagaz wali boli" 6/6, the recap + CTA
// (SERIES-KAGAZ-WALI-BOLI.md).
//
// Each problem slide is split the way the reels are: the paper problem on top
// (Marker Felt on a ruled page) and the real product underneath. The product
// half reuses the series' own captures — real screens from the local stack,
// fictional club and first-name players, cropped with ffmpeg, never redrawn —
// and a line of site copy, word for word (marketing.ts / FAQ).
// Safety: SOCIAL_CONTENT_PLAN.md §1a.
//
// usage (repo root; needs the reels' captures in reels/.work/):
//   node docs/brand/social-launch/reels/build-carousel-13-recap.cjs

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../../..");
const WEB = fs.existsSync(path.join(ROOT, "apps/web/node_modules/@playwright/test"))
  ? ROOT
  : path.resolve(ROOT, "../desiauction"); // a docs-only worktree borrows the main checkout's tools
const { chromium } = createRequire(path.join(WEB, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = path.join(__dirname, ".work");
const CROPS = path.join(W, "recap-crops");
const OUT = path.join(__dirname, "carousel-13-recap");
const KIT = path.join(ROOT, "docs/brand/kit");
const LOCKUP = path.join(KIT, "png/lockup-dark-2400.png");

const b64 = (file) => fs.readFileSync(file).toString("base64");
const font = (file) => `url("data:font/woff2;base64,${b64(file)}") format("woff2")`;
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const GEIST = path.join(
  WEB,
  "node_modules/.pnpm/@fontsource+geist-sans@5.2.5/node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
);

// Crops of the series' real captures: [name, source, ffmpeg crop w:h:x:y].
const CROP_LIST = [
  ["refused", "kaun-bola/refused.png", "1170:760:0:1110"], // the current bid + the refusal toast
  ["teams", "kitne-point/board-teams.png", null],
  ["clock", "bolna/board-t03.png", "2470:800:640:571"], // on the block, 20 pts, the clock at 3
  ["squads", "ghar-pe/viewer-squads.png", null],
  ["full-card", "squad-full/a-full.png", "1170:240:0:1330"], // the "Your squad is full" card
  ["full-button", "squad-full/a-full-button.png", null], // the locked button itself
];

const CSS = `
@font-face{font-family:Clash;src:${font(CLASH)};font-weight:600}
@font-face{font-family:Geist;src:${font(GEIST)};font-weight:600}
*{box-sizing:border-box}html,body{margin:0}
.s{width:1080px;height:1350px;position:relative;overflow:hidden;background:#0B1018;font-family:Geist,sans-serif;color:#F6F9FF}
.paper{position:absolute;left:0;right:0;top:0;height:470px;background:#F3ECDC;
  background-image:repeating-linear-gradient(180deg,transparent 0 70px,rgba(64,110,170,.22) 70px 73px),
    linear-gradient(90deg,transparent 0 96px,rgba(196,60,60,.35) 96px 99px,transparent 99px);
  font-family:"Marker Felt","Noteworthy",sans-serif;color:#1d2433;padding:56px 60px 0 128px}
.paper:after{content:"";position:absolute;left:0;right:0;bottom:-22px;height:44px;background:#F3ECDC;
  clip-path:polygon(0 0,100% 0,100% 40%,95% 70%,90% 35%,84% 75%,78% 30%,72% 70%,66% 38%,60% 78%,54% 30%,48% 72%,42% 36%,36% 74%,30% 32%,24% 70%,18% 34%,12% 76%,6% 38%,0 70%)}
.tag{font-size:30px;letter-spacing:.06em;color:#6b5a3a}
.tag b{color:#C43C3C;font-weight:400}
.q{margin:22px 0 0;font-size:92px;line-height:1.04}
.q em{font-style:normal;color:#C43C3C}
.ink{position:absolute;left:0;right:0;top:470px;bottom:0;display:flex;flex-direction:column;align-items:center;padding:70px 60px 0}
.shot{border-radius:24px;overflow:hidden;border:5px solid #2a3344;box-shadow:0 26px 70px rgba(0,0,0,.6)}
.shot img{display:block;width:100%}
.line{margin:38px 0 0;font:600 50px/1.1 Clash;letter-spacing:-.01em;text-align:center}
.line em{font-style:normal;color:#E6B24A}
.n{position:absolute;right:48px;top:52px;font:600 26px/1 Geist;letter-spacing:.12em;color:#6b5a3a;z-index:2}
.lbl{position:absolute;left:0;right:0;bottom:28px;text-align:center;font:600 22px/1 Geist;letter-spacing:.06em;color:#6f7f99}
.full{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px}
`;
const img = (name) => `data:image/png;base64,${b64(path.join(CROPS, `${name}.png`))}`;
const logo = (w) => `<img src="data:image/png;base64,${b64(LOCKUP)}" style="width:${w}px;display:block">`;
const LBL = `<div class="lbl">Demo auction · fictional players · points, not money</div>`;
// Post 1's capture was a rupee season: its slide must not say "points".
const LBL_RUPEES = `<div class="lbl">Demo auction · fictional players</div>`;

// shots: [[crop name, width], ...] stacked; label: which demo label applies.
const problem = (n, q, shots, line, label = LBL) => `<div class="s">
  <div class="paper"><div class="tag">KAGAZ WALI BOLI · <b>${n}/8</b></div><p class="q">${q}</p></div>
  <div class="ink"><div style="display:flex;flex-direction:column;align-items:center;gap:22px">${shots
    .map(([shot, width]) => `<div class="shot" style="width:${width}px"><img src="${img(shot)}"></div>`)
    .join("")}</div><p class="line">${line}</p></div>
  ${label}</div>`;

// Built after the crops exist (img() inlines the files).
const slides = () => [
  // 1 · cover — the question, on paper
  `<div class="s" style="background:#F3ECDC">
    <div class="paper" style="height:100%;padding-top:120px"><div class="tag">KAGAZ WALI BOLI · <b>1/8</b></div>
      <p class="q" style="font-size:118px;margin-top:60px">Kagaz wali boli ki <em>5 problems.</em></p>
      <p class="q" style="font-size:76px;margin-top:70px;color:#6b5a3a">Aapke auction mein kitni hain?</p>
      <p class="q" style="font-size:54px;margin-top:150px;color:#6b5a3a">Swipe karo → 📒</p></div></div>`,
  problem(2, "1. “Kaun bola <em>pehle?</em>”", [["refused", 720]],
    "The server checks every bid, <em>not the loudest voice.</em>", LBL_RUPEES),
  problem(3, "2. “Bhai, kitne point <em>bache?</em>”", [["teams", 960]],
    "Every squad and what it paid, <em>from the auction's record.</em>"),
  problem(4, "3. “Bolna kisi ne?… <em>ek baar…</em>”", [["clock", 960]],
    "SOLD, <em>without the shouting.</em>"),
  problem(5, "4. Ghar pe: “<em>kuch samajh nahi aaya</em>”", [["squads", 400]],
    "Spectators need <em>nothing at all.</em>"),
  problem(6, "5. “Do se zyada nahi <em>le sakte!</em>”", [["full-card", 860], ["full-button", 860]],
    "Every bid is checked on the server <em>before it counts.</em>"),
  // 7 · trust — the answer to "sab set hai?", site copy
  `<div class="s"><div class="n">7/8</div><div class="full">
    <p style="margin:0;font:400 64px/1.1 'Marker Felt',sans-serif;color:#9FB0CC">“Sab set hai kya?” 🤔</p>
    <p style="margin:56px 0 0;font:600 92px/1.02 Clash;letter-spacing:-.02em">Receipts on a ledger <span style="color:#E6B24A">nobody can edit</span> — including us.</p>
    <p style="margin:48px 0 0;font:600 40px/1.35 Geist;color:#9FB0CC">Nothing is edited after the fact. Corrections are new entries that explain themselves — ours included.</p>
  </div>${LBL}</div>`,
  // 8 · CTA — site copy
  `<div class="s" style="background:radial-gradient(120% 60% at 50% 38%,#1a1710 0%,#0B1018 62%)"><div class="n">8/8</div><div class="full">
    <div style="margin:0 0 70px">${logo(700)}</div>
    <p style="margin:0;font:600 96px/1.02 Clash;letter-spacing:-.02em">Your auction has one take. <span style="color:#E6B24A">Rehearse it tonight — free.</span></p>
    <p style="margin:44px 0 0;font:600 40px/1.35 Geist;color:#9FB0CC">Free during beta · always free for up to 4 teams and 40 players</p>
    <div><span style="display:inline-block;margin-top:56px;padding:24px 40px;border-radius:22px;background:#E6B24A;font:600 52px/1 Clash;color:#0B1018">desiauction.in</span></div>
  </div>${LBL}</div>`,
];

async function main() {
  fs.mkdirSync(CROPS, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, src, box] of CROP_LIST) {
    const from = path.join(W, src);
    const to = path.join(CROPS, `${name}.png`);
    if (box === null) fs.copyFileSync(from, to);
    else execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", from, "-vf", `crop=${box}`, to]);
  }
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  const SLIDES = slides();
  for (const [i, html] of SLIDES.entries()) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style>${html}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const png = path.join(OUT, `slide-${String(i + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: png });
    // Instagram takes JPEG; keep both (PNG for review, JPEG to upload).
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", png, "-q:v", "2", png.replace(/\.png$/, ".jpg")]);
  }
  await browser.close();
  console.log(path.relative(ROOT, OUT), `${SLIDES.length} slides`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
