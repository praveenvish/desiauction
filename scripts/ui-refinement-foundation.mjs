import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "apps/web/package.json"));
const { chromium, expect } = require("@playwright/test");
const { default: AxeBuilder } = require("@axe-core/playwright");
const output = "/tmp/ui-e03-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [320, 390, 1440]) {
    for (const theme of ["daylight", "floodlight"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:3050/gallery?ui-treatment=refined");
      const region = page.getByTestId("refinement-gallery");
      await expect(region).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-ui-treatment", "baseline");
      if (theme === "floodlight")
        await page.getByRole("button", { name: "Theme: daylight", exact: true }).click();
      await region
        .getByLabel("Example participant name")
        .fill("आरव मेहता · Long example participant name");
      const pending = region.getByRole("button", { name: "Show pending example", exact: true });
      await pending.focus();
      await page.keyboard.press("Enter");
      await expect(pending).toBeFocused();
      await expect(region.getByRole("status")).toContainText("not accepted");
      await expect(region.getByLabel("Example participant name")).toHaveValue(
        "आरव मेहता · Long example participant name",
      );
      for (const name of ["Show rejected example", "Reset example"]) {
        const control = region.getByRole("button", { name, exact: true });
        await control.focus();
        await page.keyboard.press("Enter");
        await expect(control).toBeFocused();
        await expect(region.getByLabel("Example participant name")).toHaveValue(
          "आरव मेहता · Long example participant name",
        );
      }
      const axe = await new AxeBuilder({ page })
        .include('[data-testid="refinement-gallery"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      if (axe.violations.length)
        throw new Error(
          JSON.stringify(
            axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          ),
        );
      const overflowing = await region.evaluate((el) =>
        [...el.querySelectorAll("*")]
          .filter(
            (child) =>
              child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1 &&
              getComputedStyle(child).overflowX !== "hidden",
          )
          .map((child) => child.tagName),
      );
      if (overflowing.length)
        throw new Error(`Foundation region overflow ${width}/${theme}: ${overflowing}`);
      await region.screenshot({ path: `${output}/foundation-${theme}-${width}.png` });
      results.push({
        width,
        theme,
        axeViolations: 0,
        retainedInput: true,
        focusContinuity: true,
        serverTreatment: "baseline despite query",
      });
      await context.close();
    }
  }
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ results, externalAcceptance: "PENDING" }, null, 2),
  );
  process.stdout.write(
    "PASS six actual foundation gallery viewport/theme states, keyboard/input retention, scoped axe and server-only treatment choice.\n",
  );
} finally {
  await browser.close();
}
