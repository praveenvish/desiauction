import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * THE ONE AXE GATE. Ten specs each carried a copy of this function, two of them
 * with the title wait below and eight without — so the same page could pass in
 * one spec and fail `document-title` in another depending on which copy
 * scanned it. One copy now, with the wait.
 *
 * After a client-side (next/link) navigation, the new <title> is committed a
 * microtask after the DOM swaps. Waiting for it lets axe's document-title rule
 * see the title the SSR HTML always carries — not a transient empty one.
 *
 * The violations are the failure message, in full: an axe failure that only
 * says "expected [] to equal [...]" sends someone to re-run it locally.
 */
export async function axeClean(page: Page, surface: string): Promise<void> {
  await page.waitForFunction(() => document.title.length > 0);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}
