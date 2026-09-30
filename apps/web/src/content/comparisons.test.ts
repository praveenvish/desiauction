import { describe, expect, it } from "vitest";

import { AUDIENCE_PAGES } from "./audiences";
import { COMPARISON_PAGES } from "./comparisons";
import { SPORT_PAGES } from "./sports";

/**
 * SEO-1 Phase 4c. Comparison pages are held to the landing-page rules, plus
 * their own: generic only (no competitor named), every row filled on both
 * sides, and a plain statement of when the old way is enough.
 */
describe("comparison pages", () => {
  it("keeps slugs, titles, headlines and descriptions unique", () => {
    for (const field of ["slug", "oldWay", "title", "headline", "description"] as const) {
      const values = COMPARISON_PAGES.map((page) => page[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
  });

  it("writes descriptions search results show whole (50–160 characters)", () => {
    const outside = COMPARISON_PAGES.filter(
      (page) => page.description.length < 50 || page.description.length > 160,
    ).map((page) => `${page.slug}: ${String(page.description.length)}`);
    expect(outside).toEqual([]);
  });

  it("fills every row on both sides, and says when the old way is enough", () => {
    for (const page of COMPARISON_PAGES) {
      expect(page.rows.length, page.slug).toBeGreaterThanOrEqual(5);
      for (const row of page.rows) {
        expect(row.without.trim(), `${page.slug}/${row.aspect}`).not.toBe("");
        expect(row.with.trim(), `${page.slug}/${row.aspect}`).not.toBe("");
      }
      expect(page.enough.length, page.slug).toBeGreaterThan(80);
      expect(page.faqs.length, page.slug).toBeGreaterThanOrEqual(3);
    }
  });

  it("repeats no paragraph found on any other landing page", () => {
    const others = new Set<string>([
      ...SPORT_PAGES.flatMap((p) => [
        p.lede,
        ...p.angles.map((a) => a.body),
        ...p.faqs.map((f) => f.answer),
      ]),
      ...AUDIENCE_PAGES.flatMap((p) => [
        p.lede,
        ...p.points.map((x) => x.body),
        ...p.steps,
        ...p.faqs.map((f) => f.answer),
      ]),
    ]);
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const page of COMPARISON_PAGES) {
      const texts = [
        page.lede,
        page.enough,
        ...page.rows.flatMap((row) => [row.without, row.with]),
        ...page.faqs.map((f) => f.answer),
      ];
      for (const text of texts) {
        if (others.has(text) || seen.has(text)) repeated.push(`${page.slug}: ${text.slice(0, 60)}`);
        seen.add(text);
      }
    }
    expect(repeated).toEqual([]);
  });

  it("dates every page with a real, past calendar date", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const page of COMPARISON_PAGES) {
      expect(page.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.updatedOn <= today, page.slug).toBe(true);
    }
  });
});
