import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { stage } from "./ui-auction-fixtures";

test("exact purse and bidding limit remain readable through narrow money reflow", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const s = await stage(browser, true);
  try {
    const values = [
      s.owner.getByTestId("my-purse").locator("dd"),
      s.owner.getByTestId("my-ceiling").locator("dd"),
    ];
    await expect(s.owner.getByTestId("my-purse").locator("dd")).toHaveText("₹2,00,00,000");
    const expected = await Promise.all(values.map((value) => value.innerText()));
    expect(expected[1]).toMatch(/^₹[\d,]+$/);
    for (const width of [320, 390, 1440]) {
      for (const theme of ["daylight", "floodlight"]) {
        for (const textScale of [1, 2]) {
          await s.owner.setViewportSize({ width, height: 900 });
          await s.owner.evaluate(
            ({ theme, textScale }) => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.fontSize = `${String(textScale * 100)}%`;
            },
            { theme, textScale },
          );
          for (const [index, value] of values.entries()) {
            await value.scrollIntoViewIfNeeded();
            const expectedValue = expected[index];
            if (expectedValue === undefined) throw new Error("Missing expected monetary figure");
            await expect(value).toHaveText(expectedValue);
            const fit = await value.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const rects = [...range.getClientRects()].filter(
                (rect) => rect.width > 0 && rect.height > 0,
              );
              const clipped: string[] = [];
              const own = element.getBoundingClientRect();
              if (rects.some((rect) => rect.left < own.left - 0.5 || rect.right > own.right + 0.5))
                clipped.push("value");
              const stat = element.closest(".my-team-stat");
              if (!stat) throw new Error("Missing financial statistic");
              const bounds = stat.getBoundingClientRect();
              const style = getComputedStyle(stat);
              if (
                rects.some(
                  (rect) =>
                    rect.left < bounds.left + parseFloat(style.paddingLeft) - 0.5 ||
                    rect.right > bounds.right - parseFloat(style.paddingRight) + 0.5,
                )
              )
                clipped.push("statistic-content");
              for (
                let ancestor = element.parentElement;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                const css = getComputedStyle(ancestor);
                const box = ancestor.getBoundingClientRect();
                if (
                  /hidden|clip|auto|scroll/.test(css.overflowX) &&
                  rects.some((rect) => rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
                )
                  clipped.push(`${ancestor.className}:x`);
                if (
                  /hidden|clip|auto|scroll/.test(css.overflowY) &&
                  rects.some((rect) => rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5)
                )
                  clipped.push(`${ancestor.className}:y`);
              }
              return {
                clipped,
                rects: rects.map((rect) => rect.toJSON() as unknown),
                text: element.textContent,
                valueBounds: own.toJSON() as unknown,
                statisticBounds: bounds.toJSON() as unknown,
              };
            });
            await writeFile(
              testInfo.outputPath(
                `money-${String(width)}-${theme}-${String(textScale)}-${String(index)}.json`,
              ),
              JSON.stringify(fit, null, 2),
            );
            await testInfo.attach(
              `money-${String(width)}-${theme}-${String(textScale)}-${String(index)}`,
              { body: JSON.stringify(fit), contentType: "application/json" },
            );
            expect(fit.clipped).toEqual([]);
          }
          const bid = s.owner.getByTestId("bid-next");
          await bid.scrollIntoViewIfNeeded();
          expect(
            await bid.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
              );
              return hit !== null && element.contains(hit);
            }),
          ).toBe(true);
          await s.owner.screenshot({
            path: testInfo.outputPath(`money-${String(width)}-${theme}-${String(textScale)}.png`),
            fullPage: true,
          });
          expect((await new AxeBuilder({ page: s.owner }).analyze()).violations).toEqual([]);
        }
      }
    }
  } finally {
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});
