/**
 * PX-11 SECURITY FIX (finding F2 — stored XSS via JSON-LD).
 *
 * `JSON.stringify` does NOT escape `<`, `>` or `&`, so serializing
 * organizer-controlled text (a competition name, an org name, a location) into a
 * `<script type="application/ld+json">` block lets a name like
 * `</script><script>alert(document.cookie)</script>` break out of the tag and
 * execute on the PUBLIC competition page for every visitor.
 *
 * This serializes for safe embedding in an HTML `<script>` element by escaping
 * the three HTML-significant characters — escaping `<` alone already makes a
 * `</script>` breakout impossible — plus the two Unicode line separators
 * (U+2028/U+2029) that terminate a JavaScript string literal. The output is
 * still valid JSON (search engines parse the escapes transparently), so SEO is
 * unaffected while the injection is structurally impossible.
 */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LS)
    .join("\\u2028")
    .split(PS)
    .join("\\u2029");
}

/*
 * ---------------------------------------------------------------------------
 * SCHEMA BUILDERS (SEO-1 Phase 2).
 *
 * Pure functions from facts we already hold to schema.org objects. Pages
 * render them through <JsonLd> (components/seo/json-ld.tsx), which is the one
 * place `serializeJsonLd` meets the DOM.
 *
 * THREE RULES, ALL FROM GOOGLE'S STRUCTURED-DATA POLICY:
 *   1. Mark up only what the page itself shows. A FAQ answer, a venue, a team
 *      that is not visible to the reader is spam when it is in the markup.
 *   2. No invented signals. No ratings until real reviews are on the page, no
 *      social profile that is not ours, no date nobody wrote.
 *   3. A required field we cannot fill honestly means no markup, not a
 *      guessed value. That is why `sportsEventJsonLd` can return null.
 * ---------------------------------------------------------------------------
 */

type JsonLdObject = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** The one Organization every other entity points at, by id. */
export function organizationId(base: string): string {
  return `${base}/#organization`;
}

/**
 * A social profile counts only when it names an account. content/social.ts
 * once carried each network's bare homepage as a placeholder, and claiming
 * "https://x.com/" as our identity would be false; this guard stays.
 */
export function isProfileUrl(href: string): boolean {
  try {
    return new URL(href).pathname.replace(/\/+$/, "") !== "";
  } catch {
    return false;
  }
}

export function organizationJsonLd(input: {
  base: string;
  supportEmail: string;
  profiles: readonly string[];
}): JsonLdObject {
  const sameAs = input.profiles.filter(isProfileUrl);
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": organizationId(input.base),
    name: "DesiAuction",
    url: `${input.base}/`,
    logo: `${input.base}/brand/icon-512.png`,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: input.supportEmail,
      areaServed: "IN",
      availableLanguage: ["en"],
    },
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/** Names the site for Google's site-name display. No SearchAction: `/search` is not a public results page. */
export function webSiteJsonLd(base: string): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name: "DesiAuction",
    url: `${base}/`,
    inLanguage: "en-IN",
    publisher: { "@id": organizationId(base) },
  };
}

/**
 * What the product is, for search and answer engines. Deliberately without
 * `aggregateRating` or `review`: Google's software-app rich result requires
 * one of them, so this earns no stars until real reviews are shown on the
 * page. Invented ratings are a manual-action offence.
 */
export function softwareApplicationJsonLd(input: {
  base: string;
  description: string;
}): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "SoftwareApplication",
    name: "DesiAuction",
    url: `${input.base}/`,
    description: input.description,
    applicationCategory: "SportsApplication",
    // A web app. There is no native app to claim.
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
    publisher: { "@id": organizationId(input.base) },
  };
}

/** Only for questions and answers the page renders in full. */
export function faqPageJsonLd(
  items: readonly { question: string; answer: string }[],
): JsonLdObject | null {
  if (items.length === 0) return null;
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export interface Crumb {
  readonly name: string;
  readonly path: string;
}

/** Home is always the first crumb. Pass the rest, ending with the current page. */
export function breadcrumbJsonLd(base: string, crumbs: readonly Crumb[]): JsonLdObject {
  const trail: Crumb[] = [{ name: "Home", path: "/" }, ...crumbs];
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${base}${crumb.path}`,
    })),
  };
}

export function techArticleJsonLd(input: {
  base: string;
  path: string;
  headline: string;
  description: string;
  /** ISO date the words last changed (HelpArticle.updatedOn). */
  dateModified: string;
}): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "TechArticle",
    headline: input.headline,
    description: input.description,
    url: `${input.base}${input.path}`,
    mainEntityOfPage: `${input.base}${input.path}`,
    dateModified: input.dateModified,
    inLanguage: "en-IN",
    author: { "@id": organizationId(input.base) },
    publisher: { "@id": organizationId(input.base) },
  };
}

export interface SeasonVenue {
  readonly name: string;
  readonly address: string | null;
  readonly city: string | null;
}

/**
 * A season's SportsEvent, or NULL when Google's required fields cannot be
 * filled honestly.
 *
 * Google's event rich result requires `startDate` and a `location` with a
 * postal address. A season's own `location` is free text ("Jaipur"), so the
 * address comes from the venue its matches are played at. A season with no
 * dates, or with no single venue that has an address or city, gets no event
 * markup. That is better than an item Search Console reports as invalid.
 */
export function sportsEventJsonLd(input: {
  base: string;
  slug: string;
  name: string;
  description: string;
  sport: string;
  startsOn: string | null;
  endsOn: string | null;
  orgName: string;
  image: string;
  venue: SeasonVenue | null;
  teams: readonly string[];
}): JsonLdObject | null {
  const venue = input.venue;
  if (input.startsOn === null || venue === null) return null;
  if (venue.address === null && venue.city === null) return null;
  return {
    "@context": CONTEXT,
    "@type": "SportsEvent",
    name: input.name,
    description: input.description,
    url: `${input.base}/c/${input.slug}`,
    image: [input.image],
    sport: input.sport,
    startDate: input.startsOn,
    ...(input.endsOn !== null ? { endDate: input.endsOn } : {}),
    // Nothing in the product cancels or postpones a season, so it is never
    // anything else. When that changes, this must change with it.
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: venue.name,
      address: {
        "@type": "PostalAddress",
        ...(venue.address !== null ? { streetAddress: venue.address } : {}),
        ...(venue.city !== null ? { addressLocality: venue.city } : {}),
        addressCountry: "IN",
      },
    },
    organizer: { "@type": "Organization", name: input.orgName },
    ...(input.teams.length > 0
      ? { competitor: input.teams.map((name) => ({ "@type": "SportsTeam", name })) }
      : {}),
  };
}

/**
 * A guide (SEO-1 Phase 6): an `Article` with the date it was first published
 * and the date its words last changed, written and published by the
 * organization — the byline is the team, never a person who did not write it.
 */
export function articleJsonLd(input: {
  base: string;
  path: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
}): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    url: `${input.base}${input.path}`,
    mainEntityOfPage: `${input.base}${input.path}`,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    inLanguage: "en-IN",
    author: { "@id": organizationId(input.base) },
    publisher: { "@id": organizationId(input.base) },
  };
}
