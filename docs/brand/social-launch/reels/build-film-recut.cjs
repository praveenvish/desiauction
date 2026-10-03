// build-film-recut.cjs — v2 of the 100 s product film ("Registration se SOLD tak")
// without the two lines that break the no-controversy checklist
// (docs/operations/SOCIAL_CONTENT_PLAN.md §1a):
//
//   10.27–12.03 s  "Ab IPL jaisa."          → "Ab phone pe."        (rule 2: no IPL)
//   12.42–24.03 s  "2 minute mein           → "Season ready,
//                   season ready."              bina kaagaz."          (rule 1: no unmeasured numbers)
//
// Each old line is covered by a feathered patch of the same background, taken
// from the frame just before the line appears (the background is static there),
// and the new line is set in the film's type (Clash Display Semibold, sizes and
// colours measured from the film) and rises in where the old one did. The audio
// is music and effects only (no voice-over), so it is copied untouched.
//
// usage (repo root):
//   mise exec -- node docs/brand/social-launch/reels/build-film-recut.cjs <film-16x9.mp4>
// Then the 9:16 cut: build-film-vertical.cjs <the v2 file>. Needs ffmpeg.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CLASH = path.join(ROOT, "packages/ui/src/fonts/clash-display/ClashDisplay-Semibold.woff2");
const FILM = path.resolve(process.argv[2]);
const WORK = path.join(__dirname, ".work/recut");
const OUT = path.join(ROOT, "docs/brand/social-launch/film/film-01-registration-se-sold-tak-16x9-v2.mp4");

const WHITE = "#F6F8FF";
const GOLD = "linear-gradient(180deg,#EDC465,#CF9B34)";

// box: the patch [x, y, w, h]; clean: the frame (s) the patch is cut from;
// show: [from, to] while the old line is on screen; rise: when the new one rises in.
const FIXES = [
  {
    name: "card",
    box: [640, 778, 640, 172], // deep enough to hide the old words rising from below
    clean: 10.2,
    show: [10.25, 12.05],
    rise: 10.3,
    // Centred under "Tournament ka auction."; cap top at y 791, like "Ab IPL jaisa."
    text: `<p style="left:0;right:0;text-align:center;top:778px;font-size:95px;letter-spacing:-.017em">
      Ab <span class="g">phone</span> pe.</p>`,
  },
  {
    name: "head",
    box: [92, 272, 568, 205], // down to just above the checklist (y 490)
    clean: 12.33,
    show: [12.4, 24.05],
    rise: 12.42,
    // Left edge x 111; cap tops at y 285 and 363, like the old two lines.
    text: `<p style="left:111px;top:276px;font-size:75px;letter-spacing:-.012em">Season ready,</p>
      <p style="left:111px;top:354px;font-size:75px;letter-spacing:-.012em">bina kaagaz.</p>`,
  },
];

function ff(args) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

const css = `@font-face{font-family:Clash;src:url("data:font/woff2;base64,${fs
  .readFileSync(CLASH)
  .toString("base64")}") format("woff2");font-weight:600}
html,body{margin:0;background:transparent;width:1920px;height:1080px;overflow:hidden}
p{position:absolute;margin:0;font-family:Clash;font-weight:600;line-height:1;color:${WHITE};white-space:nowrap}
.g{background:${GOLD};-webkit-background-clip:text;background-clip:text;color:transparent}`;

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  for (const f of FIXES) ff(["-ss", String(f.clean), "-i", FILM, "-frames:v", "1", path.join(WORK, `clean-${f.name}.png`)]);

  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const f of FIXES) {
    // The patch: the clean frame inside the box, with 16 px feathered edges.
    const src = `data:image/png;base64,${fs.readFileSync(path.join(WORK, `clean-${f.name}.png`)).toString("base64")}`;
    await page.setContent(`<style>${css}</style><canvas id="c" width="1920" height="1080"></canvas>`);
    await page.evaluate(
      async ({ src, box }) => {
        const [x, y, w, h] = box;
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.getElementById("c").getContext("2d");
        c.drawImage(img, x, y, w, h, x, y, w, h);
        c.globalCompositeOperation = "destination-in";
        const F = 16;
        const edge = (x0, y0, x1, y1, len) => {
          const g = c.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(F / len, "rgba(0,0,0,1)");
          g.addColorStop(1 - F / len, "rgba(0,0,0,1)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = g;
          c.fillRect(x, y, w, h);
        };
        edge(x, 0, x + w, 0, w);
        edge(0, y, 0, y + h, h);
      },
      { src, box: f.box },
    );
    await page.screenshot({ path: path.join(WORK, `patch-${f.name}.png`), omitBackground: true });

    await page.setContent(`<style>${css}</style>${f.text}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(WORK, `text-${f.name}.png`), omitBackground: true });
  }
  await browser.close();

  // Patches cover the old lines for exactly as long as they are on screen; the
  // new lines fade and rise 24 px over 0.3 s, as the film's own titles do.
  const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", FILM])
    .toString()
    .trim();
  const inputs = FIXES.flatMap((f) =>
    ["patch", "text"].flatMap((k) => ["-loop", "1", "-framerate", "30", "-t", dur, "-i", path.join(WORK, `${k}-${f.name}.png`)]),
  );
  let chain = "";
  let last = "0:v";
  FIXES.forEach((f, i) => {
    const [from, to] = f.show;
    const on = `enable='between(t,${from},${to})'`;
    const p = 1 + i * 2;
    chain += `[${last}][${p}:v]overlay=0:0:${on}[p${i}];`;
    chain += `[${p + 1}:v]format=rgba,fade=in:st=${f.rise}:d=0.3:alpha=1[t${i}];`;
    chain += `[p${i}][t${i}]overlay=x=0:y='if(lt(t,${f.rise + 0.3}),24*(${f.rise + 0.3}-t)/0.3,0)':${on}[v${i}];`;
    last = `v${i}`;
  });
  ff([
    "-i", FILM, ...inputs,
    "-filter_complex", chain.replace(/;$/, ""), "-map", `[${last}]`, "-map", "0:a",
    "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", OUT,
  ]);
  console.log(path.relative(ROOT, OUT));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
