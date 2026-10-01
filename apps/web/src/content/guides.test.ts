import { describe, expect, it } from "vitest";

import { istCalendarDate } from "../lib/format-date";
import { AUDIENCE_PAGES } from "./audiences";
import type { Block } from "./blocks";
import { COMPARISON_PAGES } from "./comparisons";
import { GUIDES } from "./guides";
import { HELP_ARTICLES } from "./help";
import { SPORT_PAGES } from "./sports";
import { TOOL_PAGES } from "./tools";

/**
 * SEO-1 Phase 6. The guides section is indexable only with real articles in it
 * (the plan's threshold is six), and every link a guide makes must land on a
 * page that exists — a guide pointing at a 404 is worse than no link.
 */
const LINKABLE = new Set<string>([
  "/",
  "/pricing",
  "/c",
  "/help",
  "/guides",
  ...HELP_ARTICLES.map((a) => `/help/${a.slug}`),
  ...GUIDES.map((g) => `/guides/${g.slug}`),
  ...SPORT_PAGES.map((p) => `/sports/${p.slug}`),
  ...AUDIENCE_PAGES.map((p) => `/for/${p.slug}`),
  ...COMPARISON_PAGES.map((p) => `/compare/${p.slug}`),
  ...TOOL_PAGES.map((p) => `/tools/${p.slug}`),
]);

function linksOf(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => {
    if (block.kind === "paragraph" || block.kind === "callout") {
      return (block.links ?? []).map((link) => link.href);
    }
    if (block.kind === "list" || block.kind === "steps") {
      return block.items.flatMap((item) => (item.links ?? []).map((link) => link.href));
    }
    return [];
  });
}

describe("guides", () => {
  it("has at least six real guides, so the section is worth indexing", () => {
    expect(GUIDES.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps slugs and titles unique, and summaries 50–160 characters", () => {
    for (const field of ["slug", "title", "summary"] as const) {
      const values = GUIDES.map((entry) => entry[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
    for (const entry of GUIDES) {
      expect(entry.summary.length, entry.slug).toBeGreaterThanOrEqual(50);
      expect(entry.summary.length, entry.slug).toBeLessThanOrEqual(160);
      expect(entry.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("links only to pages that exist", () => {
    const dangling = GUIDES.flatMap((entry) =>
      linksOf(entry.blocks)
        .filter((href) => !LINKABLE.has(href))
        .map((href) => `${entry.slug} → ${href}`),
    );
    expect(dangling).toEqual([]);
  });

  it("dates every guide, published on or before its last change, and not in the future", () => {
    const today = istCalendarDate();
    for (const entry of GUIDES) {
      expect(entry.publishedOn <= entry.updatedOn, entry.slug).toBe(true);
      expect(entry.updatedOn <= today, entry.slug).toBe(true);
    }
  });
});
