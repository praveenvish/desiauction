import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import "../content.css";

export const metadata: Metadata = {
  title: "Contact · DesiAuction",
  description: "How to reach the DesiAuction team.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/contact` },
};

/**
 * PX-10 P-05 — Contact (PX-1 06 P-05): support email, response-time promise, and
 * a link to help. Reachable from the error page and Forbidden states. Public.
 */
export default function ContactPage() {
  return (
    <main className="content-page content-narrow">
      <h1>Contact us</h1>
      <p className="content-lead">{SUPPORT.intro}</p>

      <div className="support-channels">
        {SUPPORT.channels.map((channel) => (
          <div key={channel.title} className="support-card">
            <h2>{channel.title}</h2>
            <p className="support-detail">
              <a href={channel.href} className="prose-link">
                {channel.detail}
              </a>
            </p>
            <p>{channel.note}</p>
          </div>
        ))}
      </div>

      <p className="prose-p">
        Looking for how something works? The{" "}
        <Link href="/help" className="prose-link">
          help centre
        </Link>{" "}
        covers setup, the auction, and the money. For more ways we can help, see{" "}
        <Link href="/support" className="prose-link">
          support
        </Link>
        .
      </p>
    </main>
  );
}
