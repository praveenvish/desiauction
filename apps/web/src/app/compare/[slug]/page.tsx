import { ButtonLink } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { COMPARISON_PAGES, comparisonPage } from "../../../content/comparisons";
import { START_CLUB_LOGIN } from "../../../lib/start-intent";
import { breadcrumbJsonLd, faqPageJsonLd } from "../../../server/seo/json-ld";
import { JsonLd } from "../../../components/seo/json-ld";
import { PageBody, PageHero, PageSection } from "../../../components/public/public-kit";
import "../../content.css";
import "../../marketing.css";
import "../../sports/sports.css";
import "../compare.css";

export function generateStaticParams() {
  return COMPARISON_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = comparisonPage(slug);
  if (page === undefined) return { title: "Compare" };
  const url = `${env.PUBLIC_BASE_URL}/compare/${page.slug}`;
  return {
    // Absolute: these titles already name the brand ("… vs DesiAuction"), and
    // the template would add it a second time.
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    openGraph: { title: page.headline, description: page.description, url, type: "website" },
  };
}

/**
 * `/compare/[slug]` (SEO-1 Phase 4c): DesiAuction against how leagues run
 * without a product. Fair to the old way, and says when it is enough.
 */
export default async function ComparisonPageView({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = comparisonPage(slug);
  if (page === undefined) {
    notFound();
  }
  const base = env.PUBLIC_BASE_URL;
  const others = COMPARISON_PAGES.filter((other) => other.slug !== page.slug);

  return (
    <main className="public-page mk sport-page">
      <JsonLd
        data={[
          faqPageJsonLd(page.faqs),
          breadcrumbJsonLd(base, [
            { name: "Compare", path: "/compare" },
            { name: page.oldWay, path: `/compare/${page.slug}` },
          ]),
        ]}
      />
      <PageHero
        eyebrow={
          <Link href="/compare" className="sport-crumb">
            Compare · {page.oldWay}
          </Link>
        }
        title={page.headline}
        lede={page.lede}
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
        <PageSection headingId="compare-table" title="Side by side">
          {/* Wide screens: a real table, row and column headers and all. A
              phone gets the same rows as cards below instead, because at 360px
              the table's DesiAuction column sat off-screen, and a visitor saw
              only the old way. Whichever does not fit is display:none, so a
              screen reader meets exactly one of them. */}
          <div
            className="compare-scroll"
            role="region"
            // Its own name: sharing the section's label made two landmarks
            // indistinguishable to a screen reader (axe landmark-unique).
            aria-label={`${page.oldWay} and DesiAuction, row by row`}
            tabIndex={0}
          >
            <table className="compare-table">
              <caption className="visually-hidden">{page.oldWay} compared with DesiAuction</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">What</span>
                  </th>
                  <th scope="col">{page.oldWay}</th>
                  <th scope="col">DesiAuction</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.aspect}>
                    <th scope="row">{row.aspect}</th>
                    <td>{row.without}</td>
                    <td>{row.with}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="compare-cards">
            {page.rows.map((row) => (
              <li key={row.aspect} className="compare-card">
                <h3>{row.aspect}</h3>
                <dl>
                  <div>
                    <dt>{page.oldWay}</dt>
                    <dd>{row.without}</dd>
                  </div>
                  <div className="compare-card-with">
                    <dt>DesiAuction</dt>
                    <dd>{row.with}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </PageSection>

        <PageSection headingId="compare-enough" title={page.enoughTitle}>
          <p className="compare-enough">{page.enough}</p>
        </PageSection>

        <PageSection headingId="compare-faq" title="Questions organizers ask">
          <div className="content-section">
            {page.faqs.map((faq) => (
              <details key={faq.question} className="faq-item">
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
          <p className="sport-guides">
            See it for your league: <Link href="/sports">by sport</Link> or{" "}
            <Link href="/for">by kind of league</Link>
            {others.map((other) => (
              <span key={other.slug}>
                , or compare with <Link href={`/compare/${other.slug}`}>{other.inSentence}</Link>
              </span>
            ))}
            .
          </p>
        </PageSection>
      </PageBody>
    </main>
  );
}
