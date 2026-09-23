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
 *
 * `exclude` is for embedded DOCUMENTS that are not this page's interface — the
 * email editor's sandboxed preview frame. axe reaches into frames: on WebKit
 * the sandboxed srcdoc frame hung the scan until the test timed out, and on
 * Firefox the email's own <h1> was read into the page's outline, so the
 * editor's h3 looked like a skipped level. The email is checked as an email,
 * not as part of the admin page.
 */
export async function axeClean(
  page: Page,
  surface: string,
  options: { exclude?: readonly string[] } = {},
): Promise<void> {
  await page.waitForFunction(() => document.title.length > 0);
  let builder = new AxeBuilder({ page });
  for (const selector of options.exclude ?? []) {
    builder = builder.exclude(selector);
  }
  const scan = await builder.analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}
