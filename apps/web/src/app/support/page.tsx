import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import "../content.css";

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
  return (
    <main className="content-page">
      <h1>Support</h1>
      <p className="content-lead">{SUPPORT.intro}</p>

      <section className="content-section" aria-labelledby="channels">
        <h2 id="channels">Contact channels</h2>
        <div className="support-channels">
          {SUPPORT.channels.map((channel) => (
            <div key={channel.title} className="support-card">
              <h3>{channel.title}</h3>
              <p className="support-detail">
                <a href={channel.href} className="prose-link">
                  {channel.detail}
                </a>
              </p>
              <p>{channel.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="content-section" aria-labelledby="categories">
        <h2 id="categories">Common issues</h2>
        <div className="support-channels">
          {SUPPORT.issueCategories.map((issue) => (
            <div key={issue.title} className="support-card">
              <h3>{issue.title}</h3>
              <p>{issue.body}</p>
              <p>
                <Link href={issue.link.href} className="prose-link">
                  {issue.link.label} →
                </Link>
              </p>
            </div>
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
      </section>

      <section className="content-section" aria-labelledby="status">
        <h2 id="status">Version &amp; status</h2>
        {/* The "system status" link pointed at /healthz — a route handler that
            answers {"status":"ok","version":"dev","checks":{}}. A visitor sent
            there during an outage got raw JSON that says "ok" regardless, which
            is worse than no status page. There is no status page yet; say so.
            TODO(founder): if a real status page is commissioned, link it here. */}
        <p className="prose-p">
          {/* `APP_VERSION` defaults to "dev", and nothing forces a real value
              at deploy time — so the sentence only quotes a version worth
              quoting. "Running version dev" on a trust page is worse than no
              version line at all. */}
          {env.APP_VERSION !== "dev" ? (
            <>
              Running version <code>{env.APP_VERSION}</code>.{" "}
            </>
          ) : null}
          See{" "}
          <Link href="/releases" className="prose-link">
            release notes
          </Link>{" "}
          for what each update delivered.
        </p>
        <p className="prose-p">
          We don&rsquo;t publish a status page yet. If DesiAuction seems down for you, email{" "}
          <a href="mailto:support@desiauction.in" className="prose-link">
            support@desiauction.in
          </a>{" "}
          — and put AUCTION NIGHT in the subject if an auction is running.
        </p>
      </section>
    </main>
  );
}
