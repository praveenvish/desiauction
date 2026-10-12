import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch();
const observations = [];
try {
  for (const view of ["delivery", "auction"])
    for (let run = 1; run <= 3; run++) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:3052/?view=${view}`);
      await page.evaluate(() => document.fonts.ready);
      const samples = await page.evaluate(async (view) => {
        const samples = [];
        for (let i = 0; i < 100; i++) {
          const control = document.querySelector(
            view === "delivery" ? '[data-action="run:1"]' : '[data-action="bid"]',
          );
          const start = performance.now();
          control.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          samples.push(performance.now() - start);
          if (view === "auction") document.querySelector("#cancel-dialog").click();
        }
        return samples;
      }, view);
      samples.sort((a, b) => a - b);
      const resources = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((r) => ({ name: new URL(r.name).pathname, bytes: r.encodedBodySize })),
      );
      observations.push({
        view,
        run,
        samples: 100,
        event:
          view === "delivery"
            ? "Example run activation to painted acknowledgement"
            : "Example bid review activation to painted consequence dialog",
        p50: samples[49],
        p95: samples[94],
        resources,
      });
      await context.close();
    }
  await fs.writeFile(
    "/tmp/ui-e02-evidence/performance.json",
    JSON.stringify(
      {
        conditions:
          "Chromium headless,390x844,reduced motion,loopback,no network/CPU throttling,warm loaded assets,100 events per run,3 matched runs per task. Prototype responsiveness only; no production/field/before-after claim.",
        observations,
      },
      null,
      2,
    ),
  );
  console.log(
    observations.map((r) => `${r.view} run${r.run}:p95 ${r.p95.toFixed(1)}ms`).join("\n"),
  );
} finally {
  await browser.close();
}
