import type { Metadata } from "next";

import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import "../content.css";

export const metadata: Metadata = {
  title: "Careers · DesiAuction",
  description: "DesiAuction is not hiring yet — but we'd still like to hear from you.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/careers` },
};

/** Honest placeholder — no fabricated open roles. Public, no auth. */
export default function CareersPage() {
  return (
    <main className="content-page content-narrow">
      <h1>Careers</h1>
      <p className="content-lead">
        DesiAuction is a small team, in beta. We don't have open roles to list yet — when we do,
        they'll appear here, not before.
      </p>
      <p className="prose-p">
        Want to work on this anyway? Write to us at{" "}
        <a href={`mailto:${SUPPORT.channels[0].detail}`} className="prose-link">
          {SUPPORT.channels[0].detail}
        </a>{" "}
        and tell us what you'd bring — we read everything.
      </p>
    </main>
  );
}
