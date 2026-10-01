import type { Metadata } from "next";

import { env } from "../../env";
import { CASE_STUDIES, HAS_CASE_STUDIES } from "../../content/case-studies";
import { ComingSoon } from "../../components/public/coming-soon";
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

const canonical = `${env.PUBLIC_BASE_URL}/case-studies`;

export const metadata: Metadata = HAS_CASE_STUDIES
  ? {
      title: "Case studies: leagues that ran their auction on DesiAuction",
      description:
        "Real leagues, in their organizers' words, with the numbers from their auction record: how they ran the night and what changed.",
      alternates: { canonical },
    }
  : {
      title: "Case studies",
      description: "Real organizer stories — nothing published yet.",
      alternates: { canonical },
      // Not in search results and not in the sitemap: a page whose whole
      // content is "nothing yet" should be reachable (a link to it must not
      // 404) without being something a search engine offers a stranger as an
      // answer. The first entry in content/case-studies.ts lifts this.
      robots: { index: false, follow: true },
    };

/**
 * `/case-studies` (SEO-1 Phase 7). The honest placeholder until the first real,
 * consented story exists (content/case-studies.ts): no fabricated case studies,
 * unlike the home page's short testimonial quotes (an explicit, narrower
 * exception). Then the list of them, newest words first. Public, no auth.
 */
export default function CaseStudiesPage() {
  if (!HAS_CASE_STUDIES) {
    return (
      <ComingSoon
        eyebrow="Proof"
        title={
          <>
            Case <em>studies</em>
          </>
        }
        lede="Full write-ups — real numbers, real organizers, on the record — will appear here once our first tournaments finish their seasons. No stock stories, no invented numbers."
      />
    );
  }
  const newest = [...CASE_STUDIES].sort((a, b) => b.updatedOn.localeCompare(a.updatedOn));
  return (
    <main className="content-page">
      <JsonLd
        data={breadcrumbJsonLd(env.PUBLIC_BASE_URL, [
          { name: "Case studies", path: "/case-studies" },
        ])}
      />
      <PageHero
        eyebrow="Proof"
        title="Leagues that ran their auction on DesiAuction"
        lede="In the organizers' own words, with the numbers taken from each auction's record."
      />
      <PageBody>
        <PageSection headingId="case-studies-list" title="All case studies">
          <TopicGrid>
            {newest.map((entry) => (
              <TopicCard
                key={entry.slug}
                href={`/case-studies/${entry.slug}`}
                title={entry.title}
                description={entry.summary}
                foot={`${entry.sport} · ${entry.city}`}
              />
            ))}
          </TopicGrid>
        </PageSection>
      </PageBody>
    </main>
  );
}
