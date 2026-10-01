import { ButtonLink } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { env } from "../../env";
import type { ToolPage } from "../../content/tools";
import { START_CLUB_LOGIN } from "../../lib/start-intent";
import { breadcrumbJsonLd, faqPageJsonLd } from "../../server/seo/json-ld";
import { JsonLd } from "../../components/seo/json-ld";
import { PageBody, PageHero, PageSection } from "../../components/public/public-kit";

/** The metadata every tool page shares, from its content entry. */
export function toolMetadata(page: ToolPage): Metadata {
  const url = `${env.PUBLIC_BASE_URL}/tools/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: { title: page.headline, description: page.description, url, type: "website" },
  };
}

/**
 * The frame around every free tool (SEO-1 Phase 4d): the hero, the tool
 * itself, its FAQ and the structured data. No sign-in, and nothing the tool
 * does leaves the visitor's browser.
 */
export function ToolShell({ page, children }: { page: ToolPage; children: ReactNode }) {
  return (
    <main className="public-page mk sport-page">
      <JsonLd
        data={[
          faqPageJsonLd(page.faqs),
          breadcrumbJsonLd(env.PUBLIC_BASE_URL, [
            { name: "Free tools", path: "/tools" },
            { name: page.name, path: `/tools/${page.slug}` },
          ]),
        ]}
      />
      <PageHero
        size="compact"
        eyebrow={
          <Link href="/tools" className="sport-crumb">
            Free tools · {page.name}
          </Link>
        }
        title={page.headline}
        lede={page.lede}
      />
      <PageBody>
        <PageSection headingId="tool-body" title={page.name}>
          {children}
        </PageSection>
        <PageSection headingId="tool-faq" title="Questions organizers ask">
          <div className="content-section">
            {page.faqs.map((faq) => (
              <details key={faq.question} className="faq-item">
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </PageSection>
        <PageSection headingId="tool-next" title="Run the whole auction on DesiAuction">
          <p className="tool-next">
            Registration, the live auction night, fixtures, the table and the money — free while we
            are in beta.
          </p>
          <div className="tool-next-actions">
            <ButtonLink href={START_CLUB_LOGIN} variant="primary">
              Start your tournament
            </ButtonLink>
            <ButtonLink href="/sports" variant="secondary">
              See it for your sport
            </ButtonLink>
          </div>
        </PageSection>
      </PageBody>
    </main>
  );
}
