import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
 * THE COMPONENT GALLERY IS A DEV TOOL, AND STAYS ONE.
 *
 * `/gallery` is deliberately absent from a production build — it is a
 * design-system showcase, not a product surface, and shipping it would widen
 * the public attack surface for nobody's benefit. That is correct, and it means
 * these specs cannot run against a precompiled (`next start`) server: at the
 * audit they were 23 of the 41 red tests, which made the suite impossible to
 * get green in the very mode that exists to stop the dev compiler exhausting
 * its heap.
 *
 * Skipping when the route is structurally absent is the honest answer. The dev
 * run still covers them, and CI runs them there.
 */
const GALLERY_IS_ABSENT = process.env["PLAYWRIGHT_PRECOMPILED"] === "1";
test.skip(GALLERY_IS_ABSENT, "/gallery is dev-only; run this suite against `next dev`");

// M-IP1-1 verification (IP-1_DESIGN §8): AA is measured, not asserted.
// Text pairs >= 4.5:1; non-text UI tokens >= 3:1 (doc 08 contrast floors).

const TEXT_PAIRS = [
  "text-primary/surface",
  "text-secondary/surface",
  "text-muted/surface",
  "text-heading/surface-raised",
  "text-accent/surface",
  "text-on-accent/accent",
  "money-value/surface",
  "money-remaining/surface",
  "success-strong/surface",
  "danger-strong/surface",
  "warning-strong/surface",
  "info-strong/surface",
];

// border-subtle/strong are decorative separators by design (doc 10 elevation
// model) — the 3:1 non-text floor applies to interactive affordances only.
const UI_TOKEN_PAIRS: [string, string][] = [
  ["accent", "surface"],
  ["focus-ring", "surface"],
  ["border-interactive", "surface"],
  ["live", "surface"],
];

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: [number, number, number], bg: [number, number, number]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(value: string): [number, number, number] {
  const rgbMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (rgbMatch?.[1] !== undefined && rgbMatch[2] !== undefined && rgbMatch[3] !== undefined) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hexMatch?.[1] !== undefined) {
    const hex = hexMatch[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  throw new Error(`unparseable color: ${value}`);
}

async function tokenValue(page: Page, token: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim(),
    token,
  );
}

for (const theme of ["daylight", "floodlight"] as const) {
  test.describe(`gallery · ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/gallery");
      await page.evaluate((t) => {
        document.documentElement.dataset["theme"] = t;
      }, theme);
      await expect(page.getByTestId("gallery-root")).toBeVisible();
    });

    test("every text pair meets AA 4.5:1, measured", async ({ page }) => {
      const results: string[] = [];
      for (const pair of TEXT_PAIRS) {
        const el = page.locator(`[data-pair="${pair}"]`);
        const { color, background } = await el.evaluate((node) => {
          const style = getComputedStyle(node);
          return { color: style.color, background: style.backgroundColor };
        });
        const r = ratio(parseColor(color), parseColor(background));
        results.push(`${theme} ${pair}: ${r.toFixed(2)}:1`);
        expect(
          r,
          `${pair} in ${theme} must be >= 4.5:1, got ${r.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      console.log(results.join("\n"));
    });

    test("non-text UI tokens meet 3:1 against surface, measured", async ({ page }) => {
      for (const [token, against] of UI_TOKEN_PAIRS) {
        const fg = parseColor(await tokenValue(page, token));
        const bg = parseColor(await tokenValue(page, against));
        const r = ratio(fg, bg);
        expect(
          r,
          `--${token} vs --${against} in ${theme} must be >= 3:1, got ${r.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    test("axe finds zero violations", async ({ page }) => {
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
    });

    test("money sample renders tabular numerals in the money color", async ({ page }) => {
      const sample = page.getByTestId("money-sample");
      await expect(sample).toHaveText("₹1,10,50,000");
      const variant = await sample.evaluate((node) => getComputedStyle(node).fontVariantNumeric);
      expect(variant).toContain("tabular-nums");
    });
  });
}

test("fonts are self-hosted — zero third-party font requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      external.push(request.url());
    }
  });
  await page.goto("/gallery");
  await page.waitForLoadState("networkidle");
  expect(external, `external requests found: ${external.join(", ")}`).toEqual([]);
});
