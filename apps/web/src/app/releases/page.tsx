import type { Metadata } from "next";

import { env } from "../../env";
import { PageIntro } from "../../components/marketing/page-intro";
import { RELEASES } from "../../content/releases";
import { slugify } from "../../lib/slug";
import "../content.css";

export const metadata: Metadata = {
  title: "Release notes · DesiAuction",
  description: "What each update to DesiAuction delivered.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/releases` },
};

/** PX-10 §5 — release notes and version. Factual history, public, no auth. */
export default function ReleasesPage() {
  return (
    <main className="content-page content-narrow">
      <PageIntro
        kicker="What's new"
        title="Release notes"
        lead={
          <>
            {/* Same guard as /support: APP_VERSION defaults to "dev", which is a
                developer string, not a version a reader should ever meet. */}
            What each update delivered.
            {env.APP_VERSION !== "dev" ? (
              <>
                {" "}
                Running version <code>{env.APP_VERSION}</code>.
              </>
            ) : null}
          </>
        }
      />
      <ol className="release-timeline">
        {RELEASES.map((release) => {
          const releaseId = `release-${slugify(release.version)}`;
          return (
            <li key={release.version} className="release" aria-labelledby={releaseId}>
              <p className="release-meta">
                <span className="release-version">{release.version}</span>
                <span>{release.date}</span>
              </p>
              <h2 id={releaseId}>{release.title}</h2>
              <ul>
                {release.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
