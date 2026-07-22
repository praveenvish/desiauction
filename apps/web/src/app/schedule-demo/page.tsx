import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import "../content.css";

export const metadata: Metadata = {
  title: "Schedule a demo · DesiAuction",
  description: "Talk to the DesiAuction team about running your tournament's auction.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/schedule-demo` },
};

/** Honest pattern — no booking-calendar backend, same as /contact. Public,
 * no auth. */
export default function ScheduleDemoPage() {
  return (
    <main className="content-page content-narrow">
      <h1>Schedule a demo</h1>
      <p className="content-lead">
        We don't have a booking calendar yet — email us and we'll set up a time that works, usually
        within a day.
      </p>
      <div className="support-channels">
        <div className="support-card">
          <h2>Email</h2>
          <p className="support-detail">
            <a href="mailto:support@desiauction.in?subject=Demo%20request" className="prose-link">
              support@desiauction.in
            </a>
          </p>
          <p>
            Tell us your tournament size and when your auction is — we'll walk you through live.
          </p>
        </div>
      </div>
      <p className="prose-p">
        In a hurry?{" "}
        <Link href="/login" className="prose-link">
          Run your auction
        </Link>{" "}
        directly — every tournament gets the full platform, free, during beta.
      </p>
    </main>
  );
}
