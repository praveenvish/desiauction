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
import { TocNav, type ContentAnchor } from "./toc-nav";

export type { ContentAnchor };

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
  /**
   * The right-hand column: a contact card, a facts card, the operator
   * identity. A narrow reading column with nothing beside it left ~40% of a
   * laptop empty on every content page — the leftover column holds something
   * useful instead. Stacks under the text on a phone.
   */
  aside,
  prose = true,
}: {
  children: ReactNode;
  anchors?: ContentAnchor[];
  meta?: ReactNode;
  related?: ReactNode;
  relatedTitle?: string;
  foot?: ReactNode;
  aside?: ReactNode;
  /** False for a main column of components (lists, cards) rather than a
      document: skips the reading measure and the element styling. */
  prose?: boolean;
}) {
  const hasSide = anchors.length > 0 || aside !== undefined;
  return (
    <div className="cl" data-side={hasSide ? "" : undefined}>
      <div className="cl-main">
        {meta === undefined ? null : <p className="cl-meta">{meta}</p>}
        {prose ? <div className="cl-prose">{children}</div> : children}
        {foot === undefined ? null : <div className="cl-foot">{foot}</div>}
      </div>

      {hasSide ? (
        <div className="cl-side">
          {anchors.length === 0 ? null : <TocNav anchors={anchors} />}
          {aside}
        </div>
      ) : null}

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
