import { SportIcon } from "@desiauction/ui";
import { sportPack } from "@desiauction/core";
import type { Metadata } from "next";

import { env } from "../../env";
import { SPORT_PAGES } from "../../content/sports";
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
import "./sports.css";

export const metadata: Metadata = {
  title: "Player auctions for every sport",
  description:
    "Run a live player auction for cricket, football, kabaddi, volleyball, esports and more: registration, auction night and the season table in one place.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/sports` },
};

/** `/sports` (SEO-1 Phase 4): every sport page, one link each. */
export default function SportsHub() {
  return (
    <main className="public-page mk sport-page">
      <JsonLd data={breadcrumbJsonLd(env.PUBLIC_BASE_URL, [{ name: "Sports", path: "/sports" }])} />
      <PageHero
        eyebrow="Sports"
        title="Player auctions for every sport"
        lede="Each sport registers players in its own roles and keeps its own table. Pick yours to see how the auction and the season work for it."
        art={<SportMontage />}
      />
      <PageBody>
        <PageSection headingId="sports-list" title="Choose your sport">
          <TopicGrid>
            {SPORT_PAGES.map((page) => {
              const pack = sportPack(page.sport);
              return (
                <TopicCard
                  key={page.slug}
                  href={`/sports/${page.slug}`}
                  title={pack?.label ?? page.title}
                  description={page.headline}
                  icon={<SportIcon sport={page.sport} size={28} />}
                />
              );
            })}
          </TopicGrid>
        </PageSection>
      </PageBody>
    </main>
  );
}
