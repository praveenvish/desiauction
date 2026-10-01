import { ButtonLink, SportIcon } from "@desiauction/ui";
import { sportPack } from "@desiauction/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { AUDIENCE_PAGES, audiencePage } from "../../../content/audiences";
import { sportPage } from "../../../content/sports";
import { START_CLUB_LOGIN } from "../../../lib/start-intent";
import { breadcrumbJsonLd, faqPageJsonLd } from "../../../server/seo/json-ld";
import { JsonLd } from "../../../components/seo/json-ld";
import {
  PageBody,
  PageHero,
  PageSection,
  SportMontage,
  TopicCard,
  TopicGrid,
} from "../../../components/public/public-kit";
import "../../content.css";
import "../../marketing.css";
import "../../sports/sports.css";

export function generateStaticParams() {
  return AUDIENCE_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = audiencePage(slug);
  if (page === undefined) return { title: "Who it's for" };
  const url = `${env.PUBLIC_BASE_URL}/for/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: { title: page.headline, description: page.description, url, type: "website" },
  };
}

/**
 * `/for/[slug]` (SEO-1 Phase 4b): how one kind of league runs on DesiAuction.
 * Every word from content/audiences.ts; the sports it links to are the sport
 * pages (content/sports.ts), so each audience page hands on to the page that
 * explains its sport's rules.
 */
export default async function AudiencePageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = audiencePage(slug);
  if (page === undefined) {
    notFound();
  }
  const base = env.PUBLIC_BASE_URL;
  const sports = page.sports.flatMap((sportSlug) => {
    const sport = sportPage(sportSlug);
    const pack = sport === undefined ? null : sportPack(sport.sport);
    return sport === undefined || pack === null ? [] : [{ page: sport, pack }];
  });

  return (
    <main className="public-page mk sport-page">
      <JsonLd
        data={[
          faqPageJsonLd(page.faqs),
          breadcrumbJsonLd(base, [
            { name: "Who it's for", path: "/for" },
            { name: page.name, path: `/for/${page.slug}` },
          ]),
        ]}
      />
      <PageHero
        eyebrow={
          <Link href="/for" className="sport-crumb">
            Who it&apos;s for · {page.name}
          </Link>
        }
        title={page.headline}
        lede={page.lede}
        art={<SportMontage sports={sports.map((sport) => sport.pack.key)} />}
        actions={
          <>
            <ButtonLink href={START_CLUB_LOGIN} variant="primary" size="lg">
              Start your tournament
            </ButtonLink>
            <ButtonLink href="/schedule-demo" variant="secondary" size="lg">
              Book a demo
            </ButtonLink>
          </>
        }
      />
      <PageBody>
        <PageSection headingId="audience-points" title="What this kind of league needs">
          <ul className="sport-angles">
            {page.points.map((point) => (
              <li key={point.title} className="sport-angle">
                <h3>{point.title}</h3>
                <p>{point.body}</p>
              </li>
            ))}
          </ul>
        </PageSection>

        <PageSection headingId="audience-steps" title="A season, start to finish">
          <ol className="audience-steps">
            {page.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </PageSection>

        {sports.length > 0 ? (
          <PageSection
            headingId="audience-sports"
            title="The sports these leagues play"
            lede="Each sport registers players in its own roles and keeps its own table."
          >
            <TopicGrid>
              {sports.map(({ page: sport, pack }) => (
                <TopicCard
                  key={sport.slug}
                  href={`/sports/${sport.slug}`}
                  title={pack.label}
                  description={sport.headline}
                  icon={<SportIcon sport={pack.key} size={28} />}
                />
              ))}
            </TopicGrid>
          </PageSection>
        ) : null}

        <PageSection headingId="audience-faq" title="Questions organizers ask">
          <div className="content-section">
            {page.faqs.map((faq) => (
              <details key={faq.question} className="faq-item">
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
          <p className="sport-guides">
            Step-by-step guides: <Link href="/help/competition-setup">setting up a season</Link>,{" "}
            <Link href="/help/registration-desk">running the registration desk</Link> and{" "}
            <Link href="/help/money-after-the-gavel">recording the money</Link>.
          </p>
        </PageSection>
      </PageBody>
    </main>
  );
}
