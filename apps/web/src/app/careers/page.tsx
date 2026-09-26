import type { Metadata } from "next";

import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import { ComingSoon } from "../../components/public/coming-soon";

export const metadata: Metadata = {
  title: "Careers · DesiAuction",
  description: "DesiAuction is not hiring yet — but we'd still like to hear from you.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/careers` },
  // Not in search results and not in the sitemap: a page whose whole content
  // is "nothing yet" should be reachable (a link to it must not 404) without
  // being something a search engine offers a stranger as an answer.
  robots: { index: false, follow: true },
};

/** Honest placeholder — no fabricated open roles. Public, no auth. */
export default function CareersPage() {
  return (
    <ComingSoon
      eyebrow="Join us"
      title="Careers"
      lede="DesiAuction is a small team, in beta. We don't have open roles to list yet — when we do, they'll appear here, not before."
      note={
        <>
          Want to work on this anyway? Write to{" "}
          <a href={`mailto:${SUPPORT.channels[0].detail}`} data-private>
            {SUPPORT.channels[0].detail}
          </a>{" "}
          and tell us what you&rsquo;d bring.
        </>
      }
    />
  );
}
