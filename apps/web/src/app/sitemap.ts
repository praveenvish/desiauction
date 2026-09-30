import type { MetadataRoute } from "next";

import { env } from "../env";
import { HELP_ARTICLES, HELP_CATEGORIES } from "../content/help";
import { LEGAL_DOCUMENTS } from "../content/legal";
import { publicCompetitionSlugs } from "../server/competition/public";
import { INDEXABLE_PAGES, isoCalendarDate } from "../server/seo/routes";

// PX-5/PX-6 SEO: the sitemap carries the public shell plus EVERY published
// competition page (visibility='public'; unlisted link-only pages stay out).
// SEO-1: the standalone pages come from the route registry
// (server/seo/routes.ts), and help and legal come from the same registries
// their pages render, so the sitemap can never fall out of step with what
// actually exists.
//
// `lastModified` is the one sitemap field Google reads (it ignores `priority`
// and `changeFrequency`), so every date here is a real content date and never
// the deploy time. Seasons carry none: `competitions` has no updated-at
// column, and a guessed date is worse than an absent one.
/**
 * REVALIDATED, NOT FROZEN AT BUILD TIME.
 *
 * This file queries the database for every published competition, and Next
 * statically generated it once at build — so a tournament published after the
 * deploy never appeared in the sitemap at all, and would not until the next
 * release. For the one surface whose entire job is telling crawlers what exists
 * NOW, a build-time snapshot is the wrong shape. Caught by the public-experience
 * e2e, which publishes a competition and then looks for it here (audit follow-up).
 *
 * Dynamic rather than time-revalidated: on a directory that gains tournaments
 * daily, "correct within an hour" is still a sitemap that can advertise a
 * competition which no longer exists and omit one that does. Crawler traffic is
 * a rounding error next to the request path this deliberately stays off.
 */
export const dynamic = "force-dynamic";

/** A category changed when its most recently changed article did. */
function categoryUpdatedOn(slug: string): string | undefined {
  return HELP_ARTICLES.filter((article) => article.category === slug)
    .map((article) => article.updatedOn)
    .sort()
    .at(-1);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.PUBLIC_BASE_URL;
  const staticEntries: MetadataRoute.Sitemap = [
    ...INDEXABLE_PAGES.map((page) => ({
      url: `${base}${page.path}`,
      lastModified: page.updatedOn,
      ...(page.changeFrequency !== undefined ? { changeFrequency: page.changeFrequency } : {}),
    })),
    ...HELP_CATEGORIES.map((category) => {
      const updatedOn = categoryUpdatedOn(category.slug);
      return {
        url: `${base}/help/category/${category.slug}`,
        ...(updatedOn !== undefined ? { lastModified: updatedOn } : {}),
        changeFrequency: "monthly" as const,
      };
    }),
    ...HELP_ARTICLES.map((article) => ({
      url: `${base}/help/${article.slug}`,
      lastModified: article.updatedOn,
      changeFrequency: "monthly" as const,
    })),
    ...LEGAL_DOCUMENTS.map((doc) => ({
      url: `${base}/legal/${doc.slug}`,
      lastModified: isoCalendarDate(doc.effective),
      changeFrequency: "yearly" as const,
    })),
  ];
  const slugs = await publicCompetitionSlugs();
  const competitionEntries: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${base}/c/${slug}`,
    changeFrequency: "daily" as const,
  }));
  return [...staticEntries, ...competitionEntries];
}
