import type { MetadataRoute } from "next";

import { env } from "../env";
import { CONSOLE_SEGMENTS, ROBOTS_ALLOW_INSIDE_CONSOLE } from "../server/seo/routes";

// Built from the SEO route registry (server/seo/routes.ts). Robots.txt only
// saves crawl budget. What keeps a console out of search is the noindex header
// middleware.ts sets on every page the registry does not claim as public.
// Google cannot see that header on a URL it is told not to fetch, so if a
// console URL ever turns up in the index, lift its Disallow until the header
// has been read.
/**
 * RENDERED PER REQUEST, NOT AT BUILD.
 *
 * Left static, Next prerendered this file while the image was being built,
 * when PUBLIC_BASE_URL is only a placeholder. Production served
 * `Sitemap: https://build.invalid/sitemap.xml`, so no crawler reading
 * robots.txt was ever pointed at the real sitemap (found by SEO-1, 2026-09-30).
 * The URL is a runtime fact, so the file is rendered at runtime.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", ...ROBOTS_ALLOW_INSIDE_CONSOLE],
        disallow: CONSOLE_SEGMENTS.map((segment) => `/${segment}`),
      },
    ],
    sitemap: `${env.PUBLIC_BASE_URL}/sitemap.xml`,
  };
}
