import { SPORTS, sportPack } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { SPORT_PAGES, TIEBREAKER_WORDS } from "./sports";

/**
 * SEO-1 Phase 4. The sport pages are written by hand, so these hold the
 * writing to what a search engine and a reader both need: a page for every
 * sport the platform runs, facts that come from a real pack, and words that
 * are this sport's own rather than a template with the noun swapped.
 */
describe("sport pages", () => {
  it("has a page for every sport the platform runs, and none for one it does not", () => {
    const paged = SPORT_PAGES.map((page) => page.sport).sort();
    expect(paged).toEqual(SPORTS.map((pack) => pack.key).sort());
    for (const page of SPORT_PAGES) expect(sportPack(page.sport), page.slug).not.toBeNull();
  });

  it("keeps slugs, titles and headlines unique", () => {
    for (const field of ["slug", "title", "headline", "description"] as const) {
      const values = SPORT_PAGES.map((page) => page[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
  });

  it("uses URL-safe slugs", () => {
    for (const page of SPORT_PAGES) expect(page.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it("writes descriptions search results show whole (50–160 characters)", () => {
    const outside = SPORT_PAGES.filter(
      (page) => page.description.length < 50 || page.description.length > 160,
    ).map((page) => `${page.slug}: ${String(page.description.length)}`);
    expect(outside).toEqual([]);
  });

  it("names every tiebreaker in words, so a page never prints a raw key", () => {
    const missing = SPORTS.flatMap((pack) =>
      pack.standings.tiebreakers
        .filter((tiebreaker) => TIEBREAKER_WORDS[tiebreaker.key] === undefined)
        .map((tiebreaker) => `${pack.key}: ${tiebreaker.key}`),
    );
    expect(missing).toEqual([]);
  });

  it("gives every page its own angles and questions, not a shared template", () => {
    // A paragraph that appears on two pages is template, and near-duplicate
    // pages are what search engines demote a whole site for.
    const seen = new Map<string, string>();
    const repeated: string[] = [];
    for (const page of SPORT_PAGES) {
      const texts = [
        page.lede,
        ...page.angles.map((angle) => angle.body),
        ...page.faqs.map((faq) => `${faq.question} ${faq.answer}`),
      ];
      for (const text of texts) {
        const other = seen.get(text);
        if (other !== undefined)
          repeated.push(`${page.slug} repeats ${other}: ${text.slice(0, 60)}`);
        seen.set(text, page.slug);
      }
      expect(page.faqs.length, page.slug).toBeGreaterThanOrEqual(3);
    }
    expect(repeated).toEqual([]);
  });

  it("dates every page with a real, past calendar date", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const page of SPORT_PAGES) {
      expect(page.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.updatedOn <= today, page.slug).toBe(true);
    }
  });
});
