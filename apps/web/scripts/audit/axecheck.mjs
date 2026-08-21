import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const AXE = readFileSync(
  "../../node_modules/.pnpm/axe-core@4.12.1/node_modules/axe-core/axe.min.js",
  "utf8",
);
const b = await chromium.launch();
const p = await b.newPage();
// A page with three deliberate, unmissable violations.
await p.setContent(`<html><body style="background:#fff">
  <p style="color:#eee">unreadable text on white</p>
  <img src="x.png">
  <button></button>
</body></html>`);
await p.addScriptTag({ content: AXE });
const v = await p.evaluate(async () =>
  (
    await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
      },
    })
  ).violations.map((x) => `${x.id} (${x.impact})`),
);
console.log("axe sanity:", v);
await b.close();
