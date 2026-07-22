import { plainTextOf } from "./blocks";
import { FAQS, HELP_ARTICLES, HELP_CATEGORIES } from "./help";
import { LEGAL_DOCUMENTS } from "./legal";
import { FEATURE_GROUPS, PRICING } from "./marketing";
import { RELEASES } from "./releases";

/**
 * PX-10 §6 — the public search index.
 *
 * NAVIGATION ONLY, exactly like the console command palette (PX-2's ruling). A
 * hit is a destination; selecting it routes. The index is built ONCE from the
 * same content modules the pages render, so search can never advertise a page
 * that doesn't exist or miss one that does — and the broken-link suite asserts
 * every href here resolves.
 *
 * The index is static data derived at module load. It ships no secret: every
 * entry is a public page, so building it in the browser (or on the server) is
 * equally safe, and it needs no backend.
 */

export type SearchSection = "Help" | "Legal" | "Marketing" | "Support" | "Release notes";

export interface SearchDoc {
  readonly title: string;
  readonly href: string;
  readonly section: SearchSection;
  /** Secondary line shown under the title. */
  readonly hint: string;
  /** Lower-cased haystack: title + summary + body. Never rendered. */
  readonly haystack: string;
}

function doc(
  title: string,
  href: string,
  section: SearchSection,
  hint: string,
  body: string,
): SearchDoc {
  return {
    title,
    href,
    section,
    hint,
    haystack: `${title} ${hint} ${body}`.toLowerCase(),
  };
}

export const SEARCH_INDEX: readonly SearchDoc[] = [
  // Marketing
  doc(
    "DesiAuction — home",
    "/",
    "Marketing",
    "The product",
    "auction night tournament player auction live bidding",
  ),
  doc(
    "Features",
    "/features",
    "Marketing",
    "What the platform does",
    FEATURE_GROUPS.flatMap((g) => [g.title, ...g.features]).join(" "),
  ),
  doc(
    "Pricing",
    "/pricing",
    "Marketing",
    "Passes, not subscriptions",
    `${PRICING.sub} ${PRICING.tiers.map((t) => `${t.name} ${t.limits}`).join(" ")}`,
  ),

  // Help — categories and articles
  ...HELP_CATEGORIES.map((category) =>
    doc(category.title, `/help/category/${category.slug}`, "Help", "Guide", category.description),
  ),
  ...HELP_ARTICLES.map((article) =>
    doc(
      article.title,
      `/help/${article.slug}`,
      "Help",
      "Help article",
      `${article.summary} ${plainTextOf(article.blocks)}`,
    ),
  ),
  doc(
    "Frequently asked questions",
    "/help/faq",
    "Help",
    "FAQ",
    FAQS.map((faq) => `${faq.question} ${faq.answer}`).join(" "),
  ),

  // Legal
  ...LEGAL_DOCUMENTS.map((legal) =>
    doc(
      legal.title,
      `/legal/${legal.slug}`,
      "Legal",
      "Legal document",
      `${legal.summary} ${plainTextOf(legal.blocks)}`,
    ),
  ),

  // Support & release notes
  doc(
    "Support",
    "/support",
    "Support",
    "Get help",
    "contact support bug report issue auction night email",
  ),
  doc("Contact", "/contact", "Support", "Reach us", "contact email support response time"),
  doc(
    "Release notes",
    "/releases",
    "Release notes",
    "What's new",
    RELEASES.flatMap((r) => [r.title, ...r.highlights]).join(" "),
  ),
];

/** Rank hits by where the query matches: title beats hint beats body. */
export function searchContent(query: string, limit = 12): readonly SearchDoc[] {
  const term = query.trim().toLowerCase();
  if (term.length < 2) {
    return [];
  }
  const terms = term.split(/\s+/);
  const scored: { doc: SearchDoc; score: number }[] = [];
  for (const entry of SEARCH_INDEX) {
    const titleLc = entry.title.toLowerCase();
    let score = 0;
    for (const word of terms) {
      if (titleLc.includes(word)) {
        score += 10;
      } else if (entry.hint.toLowerCase().includes(word)) {
        score += 4;
      } else if (entry.haystack.includes(word)) {
        score += 1;
      } else {
        // Every term must appear somewhere — AND semantics, no loose matches.
        score = -1;
        break;
      }
    }
    if (score > 0) {
      scored.push({ doc: entry, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .slice(0, limit)
    .map((entry) => entry.doc);
}

/**
 * Every INTERNAL href this content surface points at — for the broken-link
 * suite. Collects the search index's own hrefs plus every inline link in every
 * article and legal document, so the test can prove each resolves to a real
 * route.
 */
export function allContentLinks(): readonly string[] {
  const links = new Set<string>();
  for (const entry of SEARCH_INDEX) {
    links.add(entry.href);
  }
  for (const article of HELP_ARTICLES) {
    for (const block of article.blocks) {
      if (block.kind === "paragraph") {
        for (const link of block.links ?? []) {
          links.add(link.href);
        }
      } else if (block.kind === "list" || block.kind === "steps") {
        for (const item of block.items) {
          for (const link of item.links ?? []) {
            links.add(link.href);
          }
        }
      }
    }
  }
  return [...links].filter((href) => href.startsWith("/"));
}
