import type { Metadata } from "next";

import { env } from "../../env";
import { ContentPage } from "../../components/public/content-page";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Case studies · DesiAuction",
  description: "Real organizer stories — nothing published yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/case-studies` },
  // Not in search results and not in the sitemap: a page whose whole content
  // is "nothing yet" should be reachable (a link to it must not 404) without
  // being something a search engine offers a stranger as an answer.
  robots: { index: false, follow: true },
};

/** Honest placeholder — no fabricated case studies, unlike the home page's
 * short testimonial quotes (an explicit, narrower exception). Public, no
 * auth. */
export default function CaseStudiesPage() {
  return (
    <ContentPage
      eyebrow="Proof"
      title={
        <>
          Case <em>studies</em>
        </>
      }
      lede="We're in beta with our first tournaments now. Full write-ups — real numbers, real organizers, on the record — will appear here once tournaments finish their seasons."
    >
      <p className="mk-placeholder">
        Nothing published yet. No stock stories, no invented numbers — check back during beta.
      </p>
    </ContentPage>
  );
}
