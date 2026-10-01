import type { Metadata } from "next";

import { env } from "../../env";
import { AUDIENCE_PAGES } from "../../content/audiences";
import { breadcrumbJsonLd } from "../../server/seo/json-ld";
import { JsonLd } from "../../components/seo/json-ld";
import {
  PageBody,
  PageHero,
  PageSection,
  SportMontage,
  TopicCard,
  TopicGrid,
} from "../../components/public/public-kit";
import "../content.css";
import "../marketing.css";
import "../sports/sports.css";

export const metadata: Metadata = {
  title: "Who DesiAuction is for",
  description:
    "Player auctions for company leagues, housing societies, college fests, village tournaments, and turfs and academies — each run the way that league runs.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/for` },
};

/** `/for` (SEO-1 Phase 4b): every audience page, one link each. */
export default function AudiencesHub() {
  return (
    <main className="public-page mk sport-page">
      <JsonLd
        data={breadcrumbJsonLd(env.PUBLIC_BASE_URL, [{ name: "Who it's for", path: "/for" }])}
      />
      <PageHero
        eyebrow="Who it's for"
        title="Every kind of league runs differently"
        lede="A company league, a society premier league and a village tournament all want an auction night, and none of them run it the same way. Pick yours."
        art={<SportMontage />}
      />
      <PageBody>
        <PageSection headingId="audiences-list" title="Choose your league">
          <TopicGrid>
            {AUDIENCE_PAGES.map((page) => (
              <TopicCard
                key={page.slug}
                href={`/for/${page.slug}`}
                title={page.name}
                description={page.headline}
              />
            ))}
          </TopicGrid>
        </PageSection>
      </PageBody>
    </main>
  );
}
