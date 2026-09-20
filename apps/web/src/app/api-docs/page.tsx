import type { Metadata } from "next";

import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import { ContentPage } from "../../components/public/content-page";
import "../content.css";
import "../marketing.css";

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
    <ContentPage
      eyebrow="Developers"
      title={
        <>
          API <em>docs</em>
        </>
      }
      lede="DesiAuction doesn't have a public API yet. If you're building something that needs one, tell us what you're trying to do — it helps us prioritize."
    >
      <p className="mk-placeholder">
        No public API published yet — write to{" "}
        <a href={`mailto:${SUPPORT.channels[0].detail}`} className="prose-link">
          {SUPPORT.channels[0].detail}
        </a>{" "}
        with what you&rsquo;d build.
      </p>
    </ContentPage>
  );
}
