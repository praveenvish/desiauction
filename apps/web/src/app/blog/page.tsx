import { IconMessageCircle } from "@desiauction/ui";
import type { Metadata } from "next";

import { env } from "../../env";
import { PlaceholderPage } from "../../components/marketing/placeholder-page";
import "../content.css";

export const metadata: Metadata = {
  title: "Blog · DesiAuction",
  description: "Notes from the DesiAuction team — nothing published yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/blog` },
};

/** Honest placeholder — no fabricated posts. Public, no auth. */
export default function BlogPage() {
  return (
    <PlaceholderPage
      title="Blog"
      icon={IconMessageCircle}
      lead="We're in beta with our first tournaments now. Notes on running auction night, building the platform, and what we learn from real organizers will appear here as we have something worth saying — no filler posts to fill a schedule."
      note="Nothing published yet. Check back during beta."
    />
  );
}
