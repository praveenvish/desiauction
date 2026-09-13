import { IconTrophy } from "@desiauction/ui";
import type { Metadata } from "next";

import { env } from "../../env";
import { PlaceholderPage } from "../../components/marketing/placeholder-page";
import "../content.css";

export const metadata: Metadata = {
  title: "Case studies · DesiAuction",
  description: "Real organizer stories — nothing published yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/case-studies` },
};

/** Honest placeholder — no fabricated case studies. Public, no auth. */
export default function CaseStudiesPage() {
  return (
    <PlaceholderPage
      title="Case studies"
      icon={IconTrophy}
      lead="We're in beta with our first tournaments now. Full write-ups — real numbers, real organizers, on the record — will appear here once tournaments finish their seasons."
      note="Nothing published yet. No stock stories, no invented numbers — check back during beta."
    />
  );
}
