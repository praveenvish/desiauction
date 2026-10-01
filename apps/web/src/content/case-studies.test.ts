import { describe, expect, it } from "vitest";

import { CASE_STUDIES, caseStudyProblems, type CaseStudy } from "./case-studies";

/**
 * A case study is a statement about a real league, so the registry refuses an
 * entry that skips the consent record, names no season to read figures from,
 * or is dated before the organizer agreed.
 */
const valid: CaseStudy = {
  slug: "example-league-2026",
  league: "Example League",
  seasonSlug: "example-league-2026",
  city: "Jaipur",
  sport: "Box cricket",
  title: "How Example League ran its first live auction",
  summary:
    "Eight teams, one evening, every bid on the big screen: how a box-cricket league in Jaipur moved its auction off the whiteboard.",
  organizer: { name: "A. Organizer", role: "League organizer" },
  quote: "Nobody argued about a bid all night.",
  publishedOn: "2026-11-02",
  updatedOn: "2026-11-02",
  consent: {
    givenBy: "A. Organizer",
    on: "2026-10-30",
    channel: "whatsapp",
    playerNames: false,
    photos: false,
  },
  blocks: [{ kind: "paragraph", text: "The story, in the organizer's words." }],
};

describe("case studies registry", () => {
  it("every entry keeps the rules, and slugs are unique", () => {
    for (const entry of CASE_STUDIES) {
      expect(caseStudyProblems(entry), entry.slug).toEqual([]);
    }
    const slugs = CASE_STUDIES.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("accepts a complete, consented entry", () => {
    expect(caseStudyProblems(valid)).toEqual([]);
  });

  it("refuses an entry without a consent record or a season", () => {
    expect(caseStudyProblems({ ...valid, consent: { ...valid.consent, givenBy: " " } })).toContain(
      "consent.givenBy",
    );
    expect(caseStudyProblems({ ...valid, consent: { ...valid.consent, on: "soon" } })).toContain(
      "consent.on",
    );
    expect(caseStudyProblems({ ...valid, seasonSlug: "" })).toContain("seasonSlug");
  });

  it("refuses publishing before the organizer agreed", () => {
    expect(
      caseStudyProblems({ ...valid, consent: { ...valid.consent, on: "2026-11-05" } }),
    ).toContain("published before consent");
  });

  it("refuses a summary search engines would cut or ignore, and an empty story", () => {
    expect(caseStudyProblems({ ...valid, summary: "Too short." })).toContain("summary length");
    expect(caseStudyProblems({ ...valid, quote: "" })).toContain("quote");
    expect(caseStudyProblems({ ...valid, blocks: [] })).toContain("blocks");
    expect(caseStudyProblems({ ...valid, slug: "Not A Slug" })).toContain("slug");
  });
});
