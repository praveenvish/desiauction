import { IconUsers } from "@desiauction/ui";
import type { Metadata } from "next";

import { env } from "../../env";
import { PlaceholderPage } from "../../components/marketing/placeholder-page";
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
    <PlaceholderPage
      title="Careers"
      icon={IconUsers}
      lead="DesiAuction is a small team, in beta. We don't have open roles to list yet — when we do, they'll appear here, not before."
      note="No open roles right now."
    >
      Want to work on this anyway? Write to us at{" "}
      <a href={`mailto:${SUPPORT.channels[0].detail}`} className="prose-link">
        {SUPPORT.channels[0].detail}
      </a>{" "}
      and tell us what you&rsquo;d bring — we read everything.
    </PlaceholderPage>
  );
}
