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
          // The public spectate room's share cards live under `/seasons/`,
          // which is disallowed below — so a crawler that honours robots.txt
          // (Twitterbot does) fetched no preview for a shared live room. The
          // longer, more specific rule wins over `/seasons/`, and it opens the
          // spectate path only: the room is public by the season's own
          // visibility, and everything else under a season stays a console.
          "/seasons/*/auction/spectate",
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
          "/review/",
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
