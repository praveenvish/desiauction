import type { Metadata } from "next";

import { env } from "../../env";
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
      <h1>Release notes</h1>
      <p className="content-lead">
        {/* Same guard as /support: APP_VERSION defaults to "dev", which is a
            developer string, not a version a reader should ever meet. */}
        What each update delivered.
        {env.APP_VERSION !== "dev" ? (
          <>
            {" "}
            Running version <code>{env.APP_VERSION}</code>.
          </>
        ) : null}
      </p>
      {RELEASES.map((release) => {
        const releaseId = `release-${slugify(release.version)}`;
        return (
          <section key={release.version} className="release" aria-labelledby={releaseId}>
            <h2 id={releaseId}>{release.title}</h2>
            <p className="release-meta">
              {release.version} · {release.date}
            </p>
            <ul>
              {release.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
