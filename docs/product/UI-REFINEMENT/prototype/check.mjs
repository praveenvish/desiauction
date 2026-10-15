import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "apps/web/package.json"));
const { chromium, expect } = require("@playwright/test");
const { default: AxeBuilder } = require("@axe-core/playwright");
const output = "/tmp/ui-e02-evidence";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
try {
  for (const width of [320, 390, 1440])
    for (const theme of ["daylight", "floodlight"])
      for (const view of ["home", "delivery", "timed", "placement", "public", "auction"]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`http://127.0.0.1:3052/?view=${view}`);
        if (theme === "floodlight")
          await page.getByRole("button", { name: "Switch to Floodlight theme" }).click();
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        if (overflow) throw Error(`Horizontal overflow ${view}/${theme}/${width}`);
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        if (axe.violations.length)
          throw Error(
            JSON.stringify({
              view,
              theme,
              width,
              violations: axe.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                nodes: v.nodes.map((n) => n.target),
              })),
            }),
          );
        for (const scenario of view === "public"
          ? ["delayed", "waiting", "empty", "ready"]
          : ["offline", "rejected", "claim", "waiting", "empty", "ready"]) {
          await page.locator("#scenario").selectOption(scenario);
          await expect(page.locator("#scenario")).toHaveValue(scenario);
        }
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => document.activeElement.tagName);
        if (focused === "BODY") throw Error("Keyboard focus lost");
        await page.screenshot({ path: `${output}/${view}-${theme}-${width}.png`, fullPage: true });
        results.push({ view, theme, width, axeViolations: 0, overflow: false });
        await context.close();
      }
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto("http://127.0.0.1:3052/?view=delivery");
  await p.getByRole("button", { name: "Record 4 runs in example", exact: true }).click();
  await expect(p.locator(".score").first()).toContainText("90/2");
  await p.locator("#scenario").selectOption("offline");
  await p.getByRole("button", { name: "Record 4 runs in example", exact: true }).click();
  await expect(p.locator(".score").first()).toContainText("90/2");
  await expect(p.locator(".state-strip")).toContainText("1 example entries pending");
  await p.locator("#scenario").selectOption("rejected");
  await p.getByRole("button", { name: "Record 4 runs in example", exact: true }).click();
  await expect(p.locator(".score").first()).toContainText("90/2");
  await p.locator("#scenario").selectOption("claim");
  await expect(
    p.getByRole("button", { name: "Record 4 runs in example", exact: true }),
  ).toBeDisabled();
  await p.locator("#scenario").selectOption("ready");
  await expect(p.getByRole("button", { name: "Finish match", exact: true })).toBeDisabled();
  await p.reload();
  await p.getByRole("button", { name: "Finish match", exact: true }).click();
  await expect(p.getByRole("dialog")).toBeVisible();
  await expect(p.locator("#cancel-dialog")).toBeFocused();
  await p.keyboard.press("Escape");
  await expect(p.getByRole("dialog")).not.toBeVisible();
  await p.getByRole("link", { name: "← Home" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Good evening, Aarav.");
  await p.goBack();
  await expect(p.locator(".score").first()).toContainText("86/2");
  await p.goto("http://127.0.0.1:3052/?view=placement");
  await p.getByRole("button", { name: "Review round" }).click();
  await expect(p.locator("#notice")).toContainText("Enter a placement");
  await p.locator("#placement-0").fill("1");
  await p.locator("#placement-0").dispatchEvent("change");
  await p.locator("#placement-1").fill("2");
  await p.locator("#placement-1").dispatchEvent("change");
  await p.getByRole("button", { name: "Review round" }).click();
  await expect(p.getByRole("dialog")).toBeVisible();
  await p.locator("#cancel-dialog").click();
  await expect(p.locator("#placement-0")).toHaveValue("1");
  await p.goto("http://127.0.0.1:3052/?view=auction");
  await p.getByRole("button", { name: "Review bid ₹1,30,000" }).click();
  await expect(p.getByRole("dialog")).toContainText("₹2,70,000");
  await p.locator("#cancel-dialog").click();
  await expect(p.locator(".score").first()).toContainText("₹1,25,000");
  await p.goto("http://127.0.0.1:3052/?view=timed");
  await p.getByRole("button", { name: "Falcons", exact: true }).click();
  await p.locator("#scorer").selectOption("a4");
  await p.getByRole("button", { name: "Record example goal", exact: true }).click();
  await p.locator("#cancel-dialog").click();
  await expect(p.locator("#scorer")).toHaveValue("a4");
  await p.getByRole("button", { name: "Record example goal", exact: true }).click();
  await p.locator("#confirm-dialog").click();
  await expect(p.locator(".split-score .score").last()).toHaveText("2");
  await expect(p.locator(".split-score .score").first()).toHaveText("2");
  await p.goto("http://127.0.0.1:3052/?view=public");
  await p.getByRole("button", { name: "Scorecard", exact: true }).click();
  await expect(p.locator("table")).toBeVisible();
  await p.locator("#scenario").selectOption("empty");
  await expect(p.locator("table")).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "These details are unavailable" })).toBeVisible();
  await p.goto("http://127.0.0.1:3052/?view=delivery");
  const run = p.getByRole("button", { name: "Record 1 runs in example", exact: true });
  await run.focus();
  await p.keyboard.press("Enter");
  await expect(run).toBeFocused();
  await p.keyboard.press("Enter");
  await expect(run).toBeFocused();
  await expect(p.locator(".score").first()).toContainText("88/2");
  await p.getByRole("link", { name: "← Home" }).click();
  await p.getByRole("link", { name: "Open room", exact: true }).click();
  await expect(p.locator(".score").first()).toContainText("₹1,25,000");
  await expect(p.locator(".state-strip")).not.toContainText("pending for this fixture");
  await p.goto("http://127.0.0.1:3052/?view=placement");
  for (const i of [0, 1]) {
    await p.locator(`#placement-${i}`).fill("1");
    await p.locator(`#placement-${i}`).dispatchEvent("change");
  }
  await p.getByRole("button", { name: "Review round" }).click();
  await expect(p.getByRole("dialog")).toContainText("Tigers: placement 1, kills 0");
  await expect(p.getByRole("dialog")).toContainText("Falcons: placement 1, kills 0");
  await p.locator("#confirm-dialog").click();
  await expect(p.getByRole("button", { name: "Review round" })).toBeFocused();
  await expect(
    p.getByText("1 example rounds accepted. Tied placements are allowed."),
  ).toBeVisible();
  await p.goto("http://127.0.0.1:3052/?view=public");
  await p.locator("#scenario").selectOption("delayed");
  await expect(p.locator(".score")).toContainText("80/2");
  await expect(p.locator(".state-strip")).toContainText("18:40");
  await p.getByRole("button", { name: "Scorecard", exact: true }).click();
  await expect(p.getByRole("button", { name: "Scorecard", exact: true })).toBeFocused();
  await expect(p.locator("table")).toContainText("28 (23)");
  await p.locator("#scenario").selectOption("empty");
  await expect(p.locator(".score")).toHaveCount(0);
  await p.goto("http://127.0.0.1:3052/?view=delivery");
  await p.getByRole("button", { name: "Finish match", exact: true }).click();
  await p.locator("#confirm-dialog").click();
  await p.getByRole("link", { name: "Watch example live" }).click();
  await expect(p.locator(".tag")).toContainText("Example result");
  await p.locator("#scenario").selectOption("delayed");
  await expect(p.locator(".tag")).toContainText("Example live");
  await expect(p.locator(".score")).toContainText("80/2");
  await p.screenshot({ path: `${output}/public-delayed-after-terminal-390.png`, fullPage: true });
  if (errors.length) throw Error(errors.join("\n"));
  await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        checks: results,
        interactionJourneys: "PASS",
        javascriptErrors: errors,
        externalAcceptance: "PENDING",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${results.length} viewport/theme/view combinations, synthetic interactions, keyboard entry, no axe violations or overflow. Evidence ${output}`,
  );
} finally {
  await browser.close();
}
