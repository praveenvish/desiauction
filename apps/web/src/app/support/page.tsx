import type { Metadata } from "next";
import Link from "next/link";

import { ReportProblemButton } from "../../components/report-problem/report-problem";
import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import { ContentPage } from "../../components/public/content-page";
import { OperatorIdentityCard } from "../../components/public/operator-identity";
import { SideCard } from "../../components/public/public-kit";
import "../content.css";
import { IconArrowRight, IconClock, IconMail } from "@desiauction/ui";

export const metadata: Metadata = {
  title: "Support · DesiAuction",
  description: "Get help, report a bug, and see what's new.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/support` },
};

/**
 * PX-10 §5 — the Support experience. Static routing only: contact channels,
 * issue categories that link to the right help, bug-reporting guidance, release
 * notes and the version. No ticketing backend; no form here pretends to file
 * one, and no link pretends to be a status page.
 */
export default function SupportPage() {
  const channel = SUPPORT.channels[0];
  return (
    <ContentPage
      eyebrow="Support"
      title="Support"
      lede={SUPPORT.intro}
      prose={false}
      aside={
        <>
          {/* The contact route is the page's one call to action, so it takes
              the side column's top slot and the accent rim. */}
          <SideCard
            headingId="channels"
            title="Email a person"
            icon={<IconMail size={20} weight="duotone" />}
            tone="accent"
          >
            <p className="support-detail">
              <a href={channel.href} data-private>
                {channel.detail}
              </a>
            </p>
            <p>{channel.note}</p>
            <p className="support-sla">
              <IconClock size={16} /> Replies within a day during beta
            </p>
          </SideCard>
          <OperatorIdentityCard />
        </>
      }
    >
      <section className="content-section" aria-labelledby="categories">
        <h2 id="categories">Common issues</h2>
        {/* An accordion: four answers of very different lengths made a 2×2 of
            uneven cards, one of them seven lines of 13px text. */}
        <div className="support-issues">
          {SUPPORT.issueCategories.map((issue) => (
            <details key={issue.title} className="faq-item">
              <summary>{issue.title}</summary>
              <p>{issue.body}</p>
              <p>
                <Link href={issue.link.href} className="prose-link">
                  {issue.link.label}
                  <IconArrowRight size={16} className="icon-trail" />
                </Link>
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="content-section" aria-labelledby="bug">
        <h2 id="bug">{SUPPORT.bugReporting.title}</h2>
        <p className="prose-p">{SUPPORT.bugReporting.intro}</p>
        <ul className="prose-ul">
          {SUPPORT.bugReporting.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="content-actions">
          <ReportProblemButton>Report a problem</ReportProblemButton>
        </div>
      </section>

      {/* Version & status, as one footnote. The "system status" link once
          pointed at /healthz — raw JSON that says "ok" regardless — so there is
          no status link until a real status page exists.
          TODO(founder): if a real status page is commissioned, link it here.
          `APP_VERSION` defaults to "dev"; only a real version is quoted. */}
      <p className="support-foot">
        {env.APP_VERSION !== "dev" ? (
          <>
            Running version <code>{env.APP_VERSION}</code>.{" "}
          </>
        ) : null}
        What changed lately is in the{" "}
        <Link href="/releases" className="prose-link">
          release notes
        </Link>
        ; how the platform is protected is on{" "}
        <Link href="/security" className="prose-link">
          Security
        </Link>
        . There is no status page yet — if DesiAuction seems down, email us with AUCTION NIGHT in
        the subject.
      </p>
    </ContentPage>
  );
}
