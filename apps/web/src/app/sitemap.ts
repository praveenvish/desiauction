import type { MetadataRoute } from "next";

import { env } from "../env";
import { HELP_ARTICLES, HELP_CATEGORIES } from "../content/help";
import { LEGAL_DOCUMENTS } from "../content/legal";
import { AUDIENCE_PAGES } from "../content/audiences";
import { COMPARISON_PAGES } from "../content/comparisons";
import { TOOL_PAGES } from "../content/tools";
import { GUIDES } from "../content/guides";
import { CASE_STUDIES, HAS_CASE_STUDIES } from "../content/case-studies";
import { SPORT_PAGES } from "../content/sports";
import { publicSeasonSitemap } from "../server/competition/public";
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
// the deploy time. A season's date is the latest of its row (0099's trigger),
// its public fixtures, its results and its auction's last event
// (publicSeasonSitemap). Its squad pages are listed only when the organizer
// opted in AND every approved player is a known adult (server/seo/squads.ts).
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
    ...SPORT_PAGES.map((page) => ({
      url: `${base}/sports/${page.slug}`,
      lastModified: page.updatedOn,
      changeFrequency: "monthly" as const,
    })),
    ...AUDIENCE_PAGES.map((page) => ({
      url: `${base}/for/${page.slug}`,
      lastModified: page.updatedOn,
      changeFrequency: "monthly" as const,
    })),
    ...COMPARISON_PAGES.map((page) => ({
      url: `${base}/compare/${page.slug}`,
      lastModified: page.updatedOn,
      changeFrequency: "monthly" as const,
    })),
    ...TOOL_PAGES.map((page) => ({
      url: `${base}/tools/${page.slug}`,
      lastModified: page.updatedOn,
      changeFrequency: "monthly" as const,
    })),
    ...GUIDES.map((entry) => ({
      url: `${base}/guides/${entry.slug}`,
      lastModified: entry.updatedOn,
      changeFrequency: "monthly" as const,
    })),
    // Only once a real, consented story exists: until then the hub is noindex.
    ...(HAS_CASE_STUDIES
      ? [
          {
            url: `${base}/case-studies`,
            lastModified: [...CASE_STUDIES]
              .map((entry) => entry.updatedOn)
              .sort()
              .at(-1),
            changeFrequency: "monthly" as const,
          },
        ]
      : []),
    ...CASE_STUDIES.map((entry) => ({
      url: `${base}/case-studies/${entry.slug}`,
      lastModified: entry.updatedOn,
      changeFrequency: "monthly" as const,
    })),
    ...LEGAL_DOCUMENTS.map((doc) => ({
      url: `${base}/legal/${doc.slug}`,
      lastModified: isoCalendarDate(doc.effective),
      changeFrequency: "yearly" as const,
    })),
  ];
  const seasons = await publicSeasonSitemap();
  const competitionEntries: MetadataRoute.Sitemap = seasons.flatMap((season) => [
    {
      url: `${base}/c/${season.slug}`,
      lastModified: season.lastModified,
      changeFrequency: "daily" as const,
    },
    ...season.squadSlugs.map((team) => ({
      url: `${base}/c/${season.slug}/t/${team}`,
      lastModified: season.lastModified,
      changeFrequency: "weekly" as const,
    })),
  ]);
  return [...staticEntries, ...competitionEntries];
}
