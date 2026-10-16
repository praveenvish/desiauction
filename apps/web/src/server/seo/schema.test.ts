import { describe, expect, it } from "vitest";

import { FAQS } from "../../content/help";
import { PRICING } from "../../content/marketing";
import { ORGANIZATION_PROFILES, SOCIAL_ACCOUNTS } from "../../content/social";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  isProfileUrl,
  organizationId,
  organizationJsonLd,
  softwareApplicationJsonLd,
  sportsEventJsonLd,
  techArticleJsonLd,
  webSiteJsonLd,
} from "./json-ld";

/**
 * SEO-1 Phase 2. Structured data must say only what the page shows and only
 * what is true: a required field we can't fill means no markup, never a
 * guessed value. These tests hold the builders to that.
 */
const BASE = "https://desiauction.in";

const season = {
  base: BASE,
  slug: "vpl-1-513q",
  name: "VPL 1",
  description: "Vishnoi CC · 1–30 Oct 2026",
  sport: "Cricket",
  startsOn: "2026-10-01",
  endsOn: "2026-10-30",
  orgName: "Vishnoi CC",
  image: `${BASE}/c/vpl-1-513q/opengraph-image`,
  venue: { name: "Green Park", address: "Sector 5", city: "Jaipur" },
  teams: ["Strikers", "Titans"],
};

describe("organizationJsonLd", () => {
  it("never claims a social network's homepage as our profile", () => {
    // Whatever content/social.ts lists must be real profiles, never a bare homepage.
    const org = organizationJsonLd({
      base: BASE,
      supportEmail: "support@desiauction.in",
      profiles: ORGANIZATION_PROFILES,
    });
    const claimed = (org["sameAs"] as string[] | undefined) ?? [];
    expect(claimed.every(isProfileUrl)).toBe(true);
  });

  it("links every footer profile but claims only the company's own as sameAs", () => {
    expect(SOCIAL_ACCOUNTS.every((account) => isProfileUrl(account.href))).toBe(true);
    // The LinkedIn admin profile is a person, not the Organization.
    expect(ORGANIZATION_PROFILES.some((href) => href.includes("linkedin.com/in/"))).toBe(false);
    expect(ORGANIZATION_PROFILES).toContain("https://www.instagram.com/desiauction/");
  });

  it("keeps real profiles and has a stable id every other entity points at", () => {
    const org = organizationJsonLd({
      base: BASE,
      supportEmail: "support@desiauction.in",
      profiles: ["https://x.com/", "https://www.instagram.com/desiauction"],
    });
    expect(org["sameAs"]).toEqual(["https://www.instagram.com/desiauction"]);
    expect(org["@id"]).toBe(`${BASE}/#organization`);
    expect(webSiteJsonLd(BASE)["publisher"]).toEqual({ "@id": organizationId(BASE) });
  });
});

describe("isProfileUrl", () => {
  it.each([
    ["https://x.com/", false],
    ["https://www.instagram.com", false],
    ["not a url", false],
    ["https://x.com/desiauction", true],
    ["https://www.youtube.com/@desiauction", true],
  ])("%s → %s", (href, expected) => {
    expect(isProfileUrl(href)).toBe(expected);
  });
});

describe("softwareApplicationJsonLd", () => {
  it("states the free price and invents no rating", () => {
    const app = softwareApplicationJsonLd({ base: BASE, description: "x" });
    expect(app["offers"]).toEqual({ "@type": "Offer", price: "0", priceCurrency: "INR" });
    expect(app).not.toHaveProperty("aggregateRating");
    expect(app).not.toHaveProperty("review");
    expect(app["operatingSystem"]).toBe("Web");
  });
});

describe("faqPageJsonLd", () => {
  it("marks up exactly the questions the page renders", () => {
    for (const items of [FAQS, PRICING.faqs]) {
      const faq = faqPageJsonLd(items);
      const questions = (faq?.["mainEntity"] as { name: string }[]).map((q) => q.name);
      expect(questions).toEqual(items.map((item) => item.question));
    }
  });

  it("emits nothing for an empty list", () => {
    expect(faqPageJsonLd([])).toBeNull();
  });
});

describe("breadcrumbJsonLd", () => {
  it("starts at Home and numbers from 1 with absolute URLs", () => {
    const crumbs = breadcrumbJsonLd(BASE, [
      { name: "Help", path: "/help" },
      { name: "FAQ", path: "/help/faq" },
    ]);
    expect(crumbs["itemListElement"]).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
      { "@type": "ListItem", position: 2, name: "Help", item: `${BASE}/help` },
      { "@type": "ListItem", position: 3, name: "FAQ", item: `${BASE}/help/faq` },
    ]);
  });
});

describe("techArticleJsonLd", () => {
  it("dates the article by its content date", () => {
    const article = techArticleJsonLd({
      base: BASE,
      path: "/help/signing-in",
      headline: "Signing in",
      description: "How",
      dateModified: "2026-09-25",
    });
    expect(article["dateModified"]).toBe("2026-09-25");
    expect(article["url"]).toBe(`${BASE}/help/signing-in`);
  });
});

describe("sportsEventJsonLd", () => {
  it("states the venue's address, the teams and the event facts", () => {
    const event = sportsEventJsonLd(season);
    expect(event).toMatchObject({
      "@type": "SportsEvent",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      sport: "Cricket",
      location: {
        "@type": "Place",
        name: "Green Park",
        address: {
          "@type": "PostalAddress",
          streetAddress: "Sector 5",
          addressLocality: "Jaipur",
          addressCountry: "IN",
        },
      },
      competitor: [
        { "@type": "SportsTeam", name: "Strikers" },
        { "@type": "SportsTeam", name: "Titans" },
      ],
    });
  });

  it("emits NO event when Google's required fields can't be filled honestly", () => {
    expect(sportsEventJsonLd({ ...season, venue: null })).toBeNull();
    expect(sportsEventJsonLd({ ...season, startsOn: null })).toBeNull();
    expect(
      sportsEventJsonLd({ ...season, venue: { name: "Green Park", address: null, city: null } }),
    ).toBeNull();
  });

  it("keeps a city-only venue, and names no teams it doesn't have", () => {
    const event = sportsEventJsonLd({
      ...season,
      endsOn: null,
      teams: [],
      venue: { name: "Green Park", address: null, city: "Jaipur" },
    });
    expect(event).not.toBeNull();
    expect(event).not.toHaveProperty("endDate");
    expect(event).not.toHaveProperty("competitor");
    expect((event?.["location"] as { address: object }).address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Jaipur",
      addressCountry: "IN",
    });
  });
});
