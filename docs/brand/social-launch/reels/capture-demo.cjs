const fs = require("fs");
const { createRequire } = require("module");
const { chromium } = createRequire(process.cwd() + "/apps/web/package.json")("@playwright/test");
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 2.77, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto("https://desiauction.in/", { waitUntil: "networkidle" });
  await p.locator("#demo-auction").scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -20));
  await p.waitForTimeout(1200);
  // Full-resolution JPEG screenshots in a tight loop while the script plays the
  // demo. (CDP screencast caps frames near 500 px wide under mobile emulation.)
  const frames = [];
  let recording = true;
  const recorder = (async () => {
    while (recording) {
      const t = Date.now() / 1000;
      const data = await p.screenshot({ type: "jpeg", quality: 92 });
      frames.push({ t, data });
    }
  })();
  const marks = {};
  const mark = (k) => (marks[k] = Date.now() / 1000);
  await p.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) {
    await p.waitForFunction(() => { const x = [...document.querySelectorAll("#demo-auction button")].find(b => /Bid for/.test(b.textContent)); return x && !x.disabled; }, null, { timeout: 15000 });
    await p.waitForTimeout(600);
    mark("bid" + i);
    await p.locator("#demo-auction button", { hasText: /Bid for/ }).first().click();
  }
  await p.waitForFunction(() => /SOLD/i.test(document.querySelector("#demo-auction").innerText), null, { timeout: 15000 });
  mark("sold");
  await p.waitForTimeout(3000);
  recording = false;
  await recorder;
  const base = frames[0].t;
  const rel = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(v - base).toFixed(2)]));
  console.log(JSON.stringify(rel), frames.length, "span", (frames.at(-1).t - base).toFixed(2));
  const lines = [];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, "0")}.jpg`;
    fs.writeFileSync(`${OUT}/${name}`, f.data);
    const next = frames[i + 1] ? frames[i + 1].t : f.t + 1 / 30;
    lines.push(`file '${name}'`, `duration ${(next - f.t).toFixed(4)}`);
  });
  lines.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
  fs.writeFileSync(`${OUT}/list.txt`, lines.join("\n"));
  fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(rel));
  await b.close();
})();
