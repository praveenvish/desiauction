import type { Block } from "./blocks";

/**
 * THE CASE STUDIES (SEO-1 Phase 7) — `/case-studies` and `/case-studies/[slug]`.
 *
 * One entry per REAL season whose organizer agreed to it in writing
 * (docs/seo/OUTREACH-KIT.md §6). Nothing here is ever drafted ahead of that
 * agreement, and nothing is invented: the story is the organizer's, and every
 * number on the page is read from the season's auction record at render time
 * (`publicCaseStudyFigures`), never typed into this file.
 *
 * THE RULES AN ENTRY HAS TO KEEP:
 *
 *   · `consent` is recorded before the entry is merged: who agreed, when, and
 *     how. It is not rendered; it is the record that the page may exist.
 *   · No player is named, in the text or the quote, and no photo is used,
 *     unless the organizer confirmed THOSE adult players agreed. The default
 *     is numbers only. No minor, by name or by photo, ever.
 *   · The season must be PUBLISHED. The figures come from the public read
 *     model, so an unpublished season renders no figures, and the page says so
 *     rather than showing zeros.
 *
 * While this list is empty, `/case-studies` is the honest "nothing yet" page:
 * noindex, out of the sitemap, out of search, with the quiet footer. The first
 * entry switches all four on together (`HAS_CASE_STUDIES`).
 */
export interface CaseStudyConsent {
  /** The organizer who agreed, by name. */
  readonly givenBy: string;
  /** ISO date of the agreement. */
  readonly on: string;
  readonly channel: "whatsapp" | "email" | "call";
  /** True only when the organizer confirmed the NAMED adult players agreed too. */
  readonly playerNames: boolean;
  /** True only when the organizer sent the photos and agreed to their use. */
  readonly photos: boolean;
}

export interface CaseStudy {
  readonly slug: string;
  /** The league's name, as the organizer writes it. */
  readonly league: string;
  /** The published season the figures are read from (`competitions.slug`). */
  readonly seasonSlug: string;
  readonly city: string;
  /** The sport's display name, e.g. "Box cricket". */
  readonly sport: string;
  readonly title: string;
  /** Meta description and card summary: 50–160 characters. */
  readonly summary: string;
  readonly organizer: { readonly name: string; readonly role: string };
  /** One sentence, in the organizer's words, approved by them. */
  readonly quote: string;
  readonly publishedOn: string;
  /** When the words last changed (the sitemap's lastmod). */
  readonly updatedOn: string;
  readonly consent: CaseStudyConsent;
  readonly blocks: readonly Block[];
}

export const CASE_STUDIES: readonly CaseStudy[] = [];

export const HAS_CASE_STUDIES = CASE_STUDIES.length > 0;

export function caseStudy(slug: string): CaseStudy | undefined {
  return CASE_STUDIES.find((entry) => entry.slug === slug);
}

/**
 * What is wrong with an entry, or nothing. Run over the registry by the tests,
 * so an entry that skips the consent record or names nobody's season cannot be
 * merged.
 */
export function caseStudyProblems(entry: CaseStudy): string[] {
  const problems: string[] = [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) problems.push("slug");
  if (entry.seasonSlug.trim() === "") problems.push("seasonSlug");
  if (entry.summary.length < 50 || entry.summary.length > 160) problems.push("summary length");
  if (entry.quote.trim() === "") problems.push("quote");
  if (entry.blocks.length === 0) problems.push("blocks");
  if (entry.consent.givenBy.trim() === "") problems.push("consent.givenBy");
  for (const [field, value] of [
    ["consent.on", entry.consent.on],
    ["publishedOn", entry.publishedOn],
    ["updatedOn", entry.updatedOn],
  ] as const) {
    if (!iso.test(value)) problems.push(field);
  }
  if (iso.test(entry.consent.on) && entry.consent.on > entry.publishedOn) {
    problems.push("published before consent");
  }
  if (entry.updatedOn < entry.publishedOn) problems.push("updatedOn before publishedOn");
  return problems;
}
