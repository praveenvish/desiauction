/**
 * THE CONTENT LAYOUT — one reading surface for every page that is mostly words.
 *
 * Help articles, legal documents, About, Security, Rules: each had grown its
 * own column width, its own heading sizes and its own (or no) "on this page"
 * list. A visitor moving from the privacy policy to a help article crossed a
 * visible seam between two designs of the same thing.
 *
 * The measure is fixed at ~70 characters here rather than per page, because
 * that is a typographic decision and not a per-document one.
 */
import type { ReactNode } from "react";

import "./content-layout.css";
import { TopicCard, TopicGrid } from "./public-kit";

export interface ContentAnchor {
  id: string;
  label: string;
}

export function ContentLayout({
  children,
  /** "On this page". Omitted for short documents — a 3-heading list is noise. */
  anchors = [],
  /** A fact line above the text: last updated, reading time, version. */
  meta,
  /** Cards under the article — related reading, next steps. */
  related,
  relatedTitle = "Keep reading",
  /** The back link above the title band is the page's own; this is the tail. */
  foot,
}: {
  children: ReactNode;
  anchors?: ContentAnchor[];
  meta?: ReactNode;
  related?: ReactNode;
  relatedTitle?: string;
  foot?: ReactNode;
}) {
  return (
    <div className="cl">
      <div className="cl-main">
        {meta === undefined ? null : <p className="cl-meta">{meta}</p>}
        <div className="cl-prose">{children}</div>
        {foot === undefined ? null : <div className="cl-foot">{foot}</div>}
      </div>

      {anchors.length === 0 ? null : (
        <nav className="cl-aside" aria-label="On this page">
          <p className="cl-aside-title">On this page</p>
          <ol className="cl-aside-list">
            {anchors.map((anchor) => (
              <li key={anchor.id}>
                <a href={`#${anchor.id}`}>{anchor.label}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {related === undefined ? null : (
        <section className="cl-related" aria-labelledby="cl-related-heading">
          <h2 className="cl-related-title" id="cl-related-heading">
            {relatedTitle}
          </h2>
          <TopicGrid>{related}</TopicGrid>
        </section>
      )}
    </div>
  );
}

export { TopicCard };
