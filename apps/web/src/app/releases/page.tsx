import type { Metadata } from "next";

import { env } from "../../env";
import { RELEASES } from "../../content/releases";
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
        What each update delivered. Running version <code>{env.APP_VERSION}</code>.
      </p>
      {RELEASES.map((release) => (
        <section key={release.version} className="release" aria-labelledby={release.version}>
          <h2 id={release.version}>{release.title}</h2>
          <p className="release-meta">
            {release.version} · {release.date}
          </p>
          <ul>
            {release.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
