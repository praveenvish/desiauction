import type { Metadata } from "next";

import { env } from "../../env";
import { TOOL_PAGES } from "../../content/tools";
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
  title: "Free tools for tournament organizers",
  description:
    "Free tools for running a player auction: a purse and base price calculator, a registration form template that imports cleanly, and a snake draft order.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/tools` },
};

/** `/tools` (SEO-1 Phase 4d): every free tool, one link each. */
export default function ToolsHub() {
  return (
    <main className="public-page mk">
      <JsonLd
        data={breadcrumbJsonLd(env.PUBLIC_BASE_URL, [{ name: "Free tools", path: "/tools" }])}
      />
      <PageHero
        eyebrow="Free tools"
        title="Free tools for tournament organizers"
        lede="Work out a purse, set up a registration form that imports cleanly, or draw up a draft order. No account needed."
      />
      <PageBody>
        <PageSection headingId="tools-list" title="Pick a tool">
          <TopicGrid>
            {TOOL_PAGES.map((page) => (
              <TopicCard
                key={page.slug}
                href={`/tools/${page.slug}`}
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
