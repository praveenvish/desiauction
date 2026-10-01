import { describe, expect, it } from "vitest";

import { istCalendarDate } from "../lib/format-date";

import { AUDIENCE_PAGES } from "./audiences";
import { SPORT_PAGES } from "./sports";

/**
 * SEO-1 Phase 4b. The audience pages are hand-written like the sport pages,
 * and held to the same rules: unique, described in a length search results
 * show whole, linking only to sport pages that exist, and no paragraph that
 * appears on two pages (a repeated paragraph is template, not content).
 */
describe("audience pages", () => {
  it("keeps slugs, titles, headlines and descriptions unique", () => {
    for (const field of ["slug", "name", "title", "headline", "description"] as const) {
      const values = AUDIENCE_PAGES.map((page) => page[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
  });

  it("uses URL-safe slugs", () => {
    for (const page of AUDIENCE_PAGES) expect(page.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it("writes descriptions search results show whole (50–160 characters)", () => {
    const outside = AUDIENCE_PAGES.filter(
      (page) => page.description.length < 50 || page.description.length > 160,
    ).map((page) => `${page.slug}: ${String(page.description.length)}`);
    expect(outside).toEqual([]);
  });

  it("links only to sport pages that exist", () => {
    const sports = new Set(SPORT_PAGES.map((page) => page.slug));
    const dangling = AUDIENCE_PAGES.flatMap((page) =>
      page.sports.filter((slug) => !sports.has(slug)).map((slug) => `${page.slug} → ${slug}`),
    );
    expect(dangling).toEqual([]);
  });

  it("repeats no paragraph across audience or sport pages", () => {
    const seen = new Map<string, string>();
    const repeated: string[] = [];
    const record = (owner: string, text: string) => {
      const other = seen.get(text);
      if (other !== undefined) repeated.push(`${owner} repeats ${other}: ${text.slice(0, 60)}`);
      seen.set(text, owner);
    };
    for (const page of SPORT_PAGES) {
      [page.lede, ...page.angles.map((a) => a.body), ...page.faqs.map((f) => f.answer)].forEach(
        (text) => {
          record(`sports/${page.slug}`, text);
        },
      );
    }
    for (const page of AUDIENCE_PAGES) {
      [
        page.lede,
        ...page.points.map((p) => p.body),
        ...page.steps,
        ...page.faqs.map((f) => f.answer),
      ].forEach((text) => {
        record(`for/${page.slug}`, text);
      });
      expect(page.faqs.length, page.slug).toBeGreaterThanOrEqual(3);
      expect(page.steps.length, page.slug).toBeGreaterThanOrEqual(3);
    }
    expect(repeated).toEqual([]);
  });

  it("dates every page with a real, past calendar date", () => {
    // The product's calendar is IST (lib/format-date): UTC would call a date
    // written this morning in India "the future" until 05:30.
    const today = istCalendarDate();
    for (const page of AUDIENCE_PAGES) {
      expect(page.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.updatedOn <= today, page.slug).toBe(true);
    }
  });
});
