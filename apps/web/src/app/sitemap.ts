import type { MetadataRoute } from "next";

import { env } from "../env";
import { HELP_ARTICLES, HELP_CATEGORIES } from "../content/help";
import { LEGAL_DOCUMENTS } from "../content/legal";
import { publicCompetitionSlugs } from "../server/competition/public";

// PX-5/PX-6 SEO: the sitemap carries the public shell plus EVERY published
// competition page (visibility='public'; unlisted link-only pages stay out).
// PX-10 adds the marketing, help and legal surfaces — all crawlable public
// content — derived from the same registries the pages render, so the sitemap
// can never fall out of step with what actually exists.
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.PUBLIC_BASE_URL;
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly" },
    { url: `${base}/features`, changeFrequency: "monthly" },
    { url: `${base}/pricing`, changeFrequency: "monthly" },
    { url: `${base}/c`, changeFrequency: "daily" },
    { url: `${base}/help`, changeFrequency: "monthly" },
    { url: `${base}/help/faq`, changeFrequency: "monthly" },
    { url: `${base}/legal`, changeFrequency: "monthly" },
    { url: `${base}/support`, changeFrequency: "monthly" },
    { url: `${base}/contact`, changeFrequency: "monthly" },
    { url: `${base}/releases`, changeFrequency: "monthly" },
    ...HELP_CATEGORIES.map((category) => ({
      url: `${base}/help/category/${category.slug}`,
      changeFrequency: "monthly" as const,
    })),
    ...HELP_ARTICLES.map((article) => ({
      url: `${base}/help/${article.slug}`,
      changeFrequency: "monthly" as const,
    })),
    ...LEGAL_DOCUMENTS.map((doc) => ({
      url: `${base}/legal/${doc.slug}`,
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
