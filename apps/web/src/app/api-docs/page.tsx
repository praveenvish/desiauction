import type { Metadata } from "next";

import { env } from "../../env";
import { SUPPORT } from "../../content/support";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "API docs · DesiAuction",
  description: "DesiAuction does not have a public API yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/api-docs` },
};

/** Honest placeholder — no public API exists yet. Public, no auth. */
export default function ApiDocsPage() {
  return (
    <main className="content-page mk">
      <h1>API docs</h1>
      <p className="content-lead">
        DesiAuction doesn't have a public API yet. If you're building something that needs one, tell
        us what you're trying to do — it helps us prioritize.
      </p>
      <p className="mk-placeholder">
        No public API published yet — write to{" "}
        <a href={`mailto:${SUPPORT.channels[0].detail}`} className="prose-link">
          {SUPPORT.channels[0].detail}
        </a>{" "}
        with what you&rsquo;d build.
      </p>
    </main>
  );
}
