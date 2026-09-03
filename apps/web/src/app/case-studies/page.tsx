import type { Metadata } from "next";

import { env } from "../../env";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Case studies · DesiAuction",
  description: "Real organizer stories — nothing published yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/case-studies` },
};

/** Honest placeholder — no fabricated case studies, unlike the home page's
 * short testimonial quotes (an explicit, narrower exception). Public, no
 * auth. */
export default function CaseStudiesPage() {
  return (
    <main className="content-page content-narrow mk">
      <h1>Case studies</h1>
      <p className="content-lead">
        We're in beta with our first tournaments now. Full write-ups — real numbers, real
        organizers, on the record — will appear here once tournaments finish their seasons.
      </p>
      <p className="mk-placeholder">
        Nothing published yet. No stock stories, no invented numbers — check back during beta.
      </p>
    </main>
  );
}
