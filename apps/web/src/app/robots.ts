import type { MetadataRoute } from "next";

import { env } from "../env";

// PX-5 SEO: public surfaces are crawlable; consoles and token paths are not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/c",
          "/help",
          "/features",
          "/pricing",
          "/legal",
          "/support",
          "/contact",
          "/releases",
          "/login",
        ],
        disallow: [
          "/home",
          "/account",
          "/inbox",
          "/money",
          "/onboarding",
          "/orgs",
          "/org/",
          "/seasons/",
          "/join/",
          "/owner-join/",
          "/admin",
          "/search",
          "/dev/",
          "/gallery",
        ],
      },
    ],
    sitemap: `${env.PUBLIC_BASE_URL}/sitemap.xml`,
  };
}
