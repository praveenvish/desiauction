import type { Metadata } from "next";

import { env } from "../../env";
import { GUIDES } from "../../content/guides";
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

export const metadata: Metadata = {
  title: "Guides for running a league auction",
  description:
    "Practical guides for organizers: running a player auction, setting purses and base prices, auction rules, registration forms and collecting the money.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/guides` },
};

/** `/guides` (SEO-1 Phase 6): every guide, newest words first. */
export default function GuidesIndex() {
  const newest = [...GUIDES].sort((a, b) => b.updatedOn.localeCompare(a.updatedOn));
  return (
    <main className="content-page">
      <JsonLd data={breadcrumbJsonLd(env.PUBLIC_BASE_URL, [{ name: "Guides", path: "/guides" }])} />
      <PageHero
        eyebrow="Guides"
        title="Guides for running a league auction"
        lede="How to run the auction, set the purse, write the rules and collect the money — from people who build the tool leagues run it on."
      />
      <PageBody>
        <PageSection headingId="guides-list" title="All guides">
          <TopicGrid>
            {newest.map((entry) => (
              <TopicCard
                key={entry.slug}
                href={`/guides/${entry.slug}`}
                title={entry.title}
                description={entry.summary}
                foot={`${String(entry.readMinutes)} min read`}
              />
            ))}
          </TopicGrid>
        </PageSection>
      </PageBody>
    </main>
  );
}
