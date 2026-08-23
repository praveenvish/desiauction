// render-html.js — render a local HTML file to PNG with Chromium (Playwright).
//
// usage:  node render-html.js <input.html> [output.png] [width] [height]
// default width/height: 1080 x 1350  (Instagram 4:5 feed upload size)
//
// examples:
//   node render-html.js t1-statement.html
//   node render-html.js t2-number.html t2-number.png 1080 1350
//   node render-html.js *.html            <-- re-render everything (shell expands)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHROME = '/opt/pw-browsers/chromium/chrome-linux/chrome';

async function main() {
  const args = process.argv.slice(2).filter(a => a.length);
  if (!args.length) {
    console.error('usage: node render-html.js <input.html> [output.png] [width] [height]');
    process.exit(1);
  }

  // Trailing numeric args are width/height; everything else is an html input.
  let W = 1080, H = 1350;
  const nums = [];
  while (args.length && /^\d+$/.test(args[args.length - 1])) nums.unshift(parseInt(args.pop(), 10));
  if (nums.length >= 2) { W = nums[0]; H = nums[1]; }

  // If exactly two non-numeric args and the 2nd ends in .png, treat it as the output name.
  let explicitOut = null;
  if (args.length === 2 && /\.png$/i.test(args[1])) explicitOut = args.pop();

  // --disable-lcd-text forces greyscale antialiasing: no coloured subpixel fringes
  // on glyph edges, so every pixel stays on the brand palette.
  const LAUNCH = {
    args: ['--disable-lcd-text', '--disable-font-subpixel-positioning', '--force-color-profile=srgb'],
  };
  const browser = await chromium
    .launch({ ...LAUNCH, executablePath: CHROME })
    .catch(() => chromium.launch(LAUNCH));

  for (const input of args) {
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) { console.error('missing: ' + abs); continue; }
    const out = explicitOut
      ? path.resolve(explicitOut)
      : abs.replace(/\.html?$/i, '.png');

    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
    });
    await page.goto('file://' + abs, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);            // settle webfont paint
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    console.log(`${path.basename(abs)}  ->  ${path.basename(out)}   ${W}x${H}`);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
