import type { Metadata } from "next";

import { env } from "../../env";
import { ComingSoon } from "../../components/public/coming-soon";

export const metadata: Metadata = {
  title: "Blog · DesiAuction",
  description: "Notes from the DesiAuction team — nothing published yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/blog` },
  // Not in search results and not in the sitemap: a page whose whole content
  // is "nothing yet" should be reachable (a link to it must not 404) without
  // being something a search engine offers a stranger as an answer.
  robots: { index: false, follow: true },
};

/** Honest placeholder — no fabricated posts. Public, no auth. */
export default function BlogPage() {
  return (
    <ComingSoon
      eyebrow="Notes"
      title="Blog"
      lede="Notes on running auction night, building the platform, and what we learn from real organizers will appear here when we have something worth saying — no filler posts to fill a schedule."
    />
  );
}
