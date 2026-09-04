import type { Metadata } from "next";

import { env } from "../../env";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Blog · DesiAuction",
  description: "Notes from the DesiAuction team — nothing published yet.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/blog` },
};

/** Honest placeholder — no fabricated posts. Public, no auth. */
export default function BlogPage() {
  return (
    <main className="content-page content-narrow mk">
      <h1>Blog</h1>
      <p className="content-lead">
        We're in beta with our first tournaments now. Notes on running auction night, building the
        platform, and what we learn from real organizers will appear here as we have something worth
        saying — no filler posts to fill a schedule.
      </p>
      <p className="mk-placeholder">Nothing published yet. Check back during beta.</p>
    </main>
  );
}
