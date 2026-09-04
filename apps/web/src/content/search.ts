import { plainTextOf } from "./blocks";
import { FAQS, HELP_ARTICLES, HELP_CATEGORIES } from "./help";
import { LEGAL_DOCUMENTS } from "./legal";
import { FEATURE_GROUPS, PRICING } from "./marketing";
import { RELEASES } from "./releases";

/**
 * PX-10 §6 — the public search index.
 *
 * NAVIGATION ONLY, exactly like the console command palette (PX-2's ruling). A
 * hit is a destination; selecting it routes. Content-driven entries are built
 * from the same modules the pages render, so those can never drift — and the
 * broken-link suite asserts every href here resolves.
 *
 * The static entries below are the part that CAN drift, and did: eleven live
 * public routes were missing from this list, so the index quietly answered
 * "security" with a sign-in article and never with /security. content.test.ts
 * now asserts every public route has an entry, so adding a page without adding
 * it here fails the suite rather than the customer.
 *
 * The index is static data derived at module load. It ships no secret: every
 * entry is a public page, so building it in the browser (or on the server) is
 * equally safe, and it needs no backend.
 */

export type SearchSection = "Help" | "Legal" | "Product" | "Support" | "Release notes";

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
    "Product",
    "What DesiAuction is",
    "auction night tournament player auction live bidding",
  ),
  doc(
    "Features",
    "/features",
    "Product",
    "What the platform does",
    FEATURE_GROUPS.flatMap((g) => [g.title, ...g.features]).join(" "),
  ),
  doc(
    "Pricing",
    "/pricing",
    "Product",
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

  // --- The pages the index used to omit -------------------------------------
  // Eleven live public routes were missing, and the release notes claimed
  // "search that reaches every public destination". The clearest failure:
  // searching "security" returned a sign-in help article and NOT /security,
  // the page that exists to answer that exact word. An index that skips a page
  // is worse than no index — it answers, wrongly, with confidence.
  doc(
    "Security",
    "/security",
    "Product",
    "How the platform is built",
    "server verified bidding append only immutable ledger snapshot recovery grants not roles passkeys audit access control data protection",
  ),
  doc(
    "About DesiAuction",
    "/about",
    "Product",
    "Who we are",
    "about us company mission beta story team",
  ),
  doc("Careers", "/careers", "Product", "Working here", "careers jobs hiring roles open"),
  doc(
    "Rules & guidelines",
    "/rules-guidelines",
    "Product",
    "Using the platform fairly",
    "rules guidelines fair play conduct acceptable use",
  ),
  doc(
    "Book a demo",
    "/schedule-demo",
    "Product",
    "Book a live walkthrough",
    "demo walkthrough call sales talk to us book booking time slot appointment",
  ),
  doc("Blog", "/blog", "Product", "Writing", "blog posts articles news updates"),
  doc(
    "Case studies",
    "/case-studies",
    "Product",
    "Tournaments in practice",
    "case studies customers stories examples",
  ),
  doc(
    "API docs",
    "/api-docs",
    "Product",
    "For developers",
    "api docs integration developer webhook endpoint",
  ),
  doc(
    "Legal centre",
    "/legal",
    "Legal",
    "All documents",
    "legal centre terms privacy refunds cookies retention disclaimer conduct policies",
  ),
  doc(
    "Help centre",
    "/help",
    "Help",
    "All guides",
    "help centre guides articles support how to documentation",
  ),
  doc(
    "Browse tournaments",
    "/c",
    "Product",
    "The public directory",
    "tournaments directory published competitions seasons browse watch live spectate",
  ),
  doc(
    "Your tournaments",
    "/tournaments",
    "Product",
    "In the app",
    "tournaments seasons your competitions workspace organizer",
  ),
];

/**
 * What real people type, mapped to what the index actually contains.
 *
 * Measured misses before this existed, every one returning ZERO results:
 * `organiser` (the British and Indian spelling — `organizer` returned ten, and
 * this is the single most damaging miss in this market), `otp`, `whatsapp`,
 * `log in`, `captain`, `icon`, `coach`, `overlay`, `api`, `sla`, `gdpr`,
 * `dpdp`, `delete my account`.
 *
 * Expansion is per TERM and additive: a term matches if it OR any of its
 * expansions is found, so AND semantics across terms are untouched and no
 * synonym can widen a query into noise.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  organiser: ["organizer"],
  organisers: ["organizer"],
  organisation: ["organization"],
  organisations: ["organization"],
  otp: ["one-time code", "code", "sign-in"],
  sms: ["code", "sign-in", "mobile"],
  whatsapp: ["share", "link", "register"],
  login: ["sign in", "signing in"],
  "log in": ["sign in", "signing in"],
  signin: ["sign in", "signing in"],
  password: ["passkey", "sign in"],
  captain: ["captains"],
  icon: ["icons"],
  coach: ["coaches"],
  marquee: ["icon"],
  retained: ["icon"],
  overlay: ["broadcast", "screens for the room"],
  scoreboard: ["board", "screens for the room"],
  projector: ["board", "screens for the room"],
  obs: ["broadcast", "overlay"],
  stream: ["broadcast", "overlay"],
  api: ["api docs"],
  sla: ["support", "response"],
  uptime: ["support", "beta"],
  gdpr: ["privacy", "data retention"],
  dpdp: ["privacy", "data retention"],
  delete: ["deletion"],
  gst: ["gstin", "tax"],
  gstin: ["gst"],
  tally: ["export"],
  upi: ["collection", "payment"],
  refund: ["refunds"],
  invoice: ["invoices"],
  roles: ["role", "grant"],
  permission: ["grant", "capability"],
  permissions: ["grant", "capability"],
  admin: ["grant", "owner"],
  bid: ["bidding", "bids"],
  paddle: ["paddles", "owner"],
};

/** A term matches if it, or any of its synonyms, is present in `haystack`. */
function matches(haystack: string, term: string): boolean {
  if (haystack.includes(term)) {
    return true;
  }
  return (SYNONYMS[term] ?? []).some((alias) => haystack.includes(alias));
}

/**
 * Whole-word containment.
 *
 * Title scoring used bare `includes`, so every title containing the product's
 * own name scored a full title hit for "auction" — "A tour of DesiAuction"
 * outranked "Auction guide" on the query `auction`, on a site about auctions.
 */
function hasWord(text: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at === -1) {
      return false;
    }
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + word.length] ?? "";
    const boundary = (char: string) => char === "" || !/[a-z0-9]/.test(char);
    if (boundary(before ?? "") && boundary(after)) {
      return true;
    }
    from = at + 1;
  }
}

function titleHit(title: string, term: string): boolean {
  if (hasWord(title, term)) {
    return true;
  }
  return (SYNONYMS[term] ?? []).some((alias) => hasWord(title, alias));
}

/**
 * Words that carry no signal here and, under substring matching, would fail a
 * query outright: "delete my account" returned nothing because "my" appears in
 * no haystack. Dropped unless the query is nothing but stopwords.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "our",
  "your",
  "of",
  "for",
  "to",
  "and",
  "or",
  "is",
  "are",
  "in",
  "on",
  "how",
  "do",
  "i",
  "can",
  "what",
]);

/**
 * Rank hits by where the query matches: title beats hint beats body.
 *
 * Returns EVERY match, ranked. It used to hard-cap at twelve and hand the
 * caller no way to know it had — so the results page rendered "12 results" for
 * a query with twenty-seven matches, and rows 13–27 were unreachable by any
 * route. Truncation is a rendering decision and belongs to the caller; pass
 * `limit` only when you mean to discard the rest.
 */
export function searchContent(query: string, limit?: number): readonly SearchDoc[] {
  const term = query.trim().toLowerCase();
  if (term.length < 2) {
    return [];
  }
  // A multi-word phrase that IS a synonym key ("log in") is kept whole —
  // splitting it would drop "in" as a stopword and hunt for the word "log".
  const all = term.split(/\s+/).filter((word) => word.length > 0);
  const meaningful = all.filter((word) => !STOPWORDS.has(word));
  const terms = SYNONYMS[term] === undefined ? (meaningful.length > 0 ? meaningful : all) : [term];
  const scored: { doc: SearchDoc; score: number }[] = [];
  for (const entry of SEARCH_INDEX) {
    const titleLc = entry.title.toLowerCase();
    const hintLc = entry.hint.toLowerCase();
    let score = 0;
    for (const word of terms) {
      if (titleHit(titleLc, word)) {
        score += 10;
      } else if (matches(hintLc, word)) {
        score += 4;
      } else if (matches(entry.haystack, word)) {
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
  const ranked = scored
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .map((entry) => entry.doc);
  return limit === undefined ? ranked : ranked.slice(0, limit);
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
  // The doc-comment above has always said "every article AND LEGAL DOCUMENT".
  // Only the articles were walked, so a dead link in a legal document — the
  // pages a reader reaches when something has already gone wrong — was the one
  // kind this suite was blind to. Callouts are walked too, now that a callout
  // can carry a link at all.
  for (const blocks of [
    ...HELP_ARTICLES.map((article) => article.blocks),
    ...LEGAL_DOCUMENTS.map((document) => document.blocks),
  ]) {
    for (const block of blocks) {
      if (block.kind === "paragraph" || block.kind === "callout") {
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
