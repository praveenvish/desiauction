import type { Metadata } from "next";

import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import { ComingSoon } from "../../components/public/coming-soon";

export const metadata: Metadata = {
  title: "API docs · DesiAuction",
  description: "DesiAuction does not have a public API yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/api-docs` },
  // Not in search results and not in the sitemap: a page whose whole content
  // is "nothing yet" should be reachable (a link to it must not 404) without
  // being something a search engine offers a stranger as an answer.
  robots: { index: false, follow: true },
};

/** Honest placeholder — no public API exists yet. Public, no auth. */
export default function ApiDocsPage() {
  return (
    <ComingSoon
      eyebrow="Developers"
      title={
        <>
          API <em>docs</em>
        </>
      }
      lede="DesiAuction doesn't have a public API yet."
      note={
        <>
          Building something that needs one? Tell us what at{" "}
          <a href={`mailto:${SUPPORT.channels[0].detail}`} data-private>
            {SUPPORT.channels[0].detail}
          </a>{" "}
          — it helps us prioritize.
        </>
      }
    />
  );
}
