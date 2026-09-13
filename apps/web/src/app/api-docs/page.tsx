import { IconLayers } from "@desiauction/ui";
import type { Metadata } from "next";

import { env } from "../../env";
import { PlaceholderPage } from "../../components/marketing/placeholder-page";
import { SUPPORT } from "../../content/support";
import "../content.css";

export const metadata: Metadata = {
  title: "API docs · DesiAuction",
  description: "DesiAuction does not have a public API yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/api-docs` },
};

/** Honest placeholder — no public API exists yet. Public, no auth. */
export default function ApiDocsPage() {
  return (
    <PlaceholderPage
      title="API docs"
      icon={IconLayers}
      lead="DesiAuction doesn't have a public API yet. If you're building something that needs one, tell us what you're trying to do — it helps us prioritize."
      note="No public API published yet."
    >
      Write to{" "}
      <a href={`mailto:${SUPPORT.channels[0].detail}`} className="prose-link">
        {SUPPORT.channels[0].detail}
      </a>{" "}
      with what you&rsquo;d build.
    </PlaceholderPage>
  );
}
