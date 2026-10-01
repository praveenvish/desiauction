import type { Metadata } from "next";

import { env } from "../../env";
import { COMPARISON_PAGES } from "../../content/comparisons";
import { breadcrumbJsonLd } from "../../server/seo/json-ld";
import { JsonLd } from "../../components/seo/json-ld";
import {
  PageBody,
  PageHero,
  PageSection,
  TopicCard,
  TopicGrid,
} from "../../components/public/public-kit";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  // Absolute: the title already names the brand; the template would repeat it.
  title: { absolute: "Compare DesiAuction with how you run it now" },
  description:
    "How running a league on DesiAuction compares with a spreadsheet and a WhatsApp group, or with a manual auction of chits, paddles and a whiteboard.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/compare` },
};

/** `/compare` (SEO-1 Phase 4c): every comparison page, one link each. */
export default function ComparisonsHub() {
  return (
    <main className="public-page mk">
      <JsonLd
        data={breadcrumbJsonLd(env.PUBLIC_BASE_URL, [{ name: "Compare", path: "/compare" }])}
      />
      <PageHero
        eyebrow="Compare"
        title="How DesiAuction compares with the way you run it now"
        lede="Most leagues already run on something — a sheet, a group, a whiteboard. Here is what changes, side by side, and when the old way is still enough."
      />
      <PageBody>
        <PageSection headingId="compare-list" title="Choose a comparison">
          <TopicGrid>
            {COMPARISON_PAGES.map((page) => (
              <TopicCard
                key={page.slug}
                href={`/compare/${page.slug}`}
                title={page.oldWay}
                description={page.headline}
              />
            ))}
          </TopicGrid>
        </PageSection>
      </PageBody>
    </main>
  );
}
