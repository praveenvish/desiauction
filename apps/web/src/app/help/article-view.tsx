import type { ReactNode } from "react";

import { PageIntro } from "../../components/marketing/page-intro";
import { Prose, tocOf, type Block } from "../../content/blocks";

/**
 * PX-10 shared article layout: prose with an "In this article" table of contents
 * that becomes sticky beside the text above 1024px (PX-1 06 P-03). Pure
 * presentation — it renders the blocks it's given. Help and legal both use it
 * now; legal used to re-implement the same shape inline without the contents.
 */
export function ArticleView({
  title,
  meta,
  blocks,
  backHref = "/help",
  backLabel = "All help",
  children,
}: {
  title: string;
  meta?: string;
  blocks: readonly Block[];
  backHref?: string;
  backLabel?: string;
  /** Rendered after the prose, inside the article column (e.g. a version history). */
  children?: ReactNode;
}) {
  const toc = tocOf(blocks);
  return (
    <main className="content-page">
      <PageIntro title={title} back={{ href: backHref, label: backLabel }}>
        {meta !== undefined ? <p className="article-meta">{meta}</p> : null}
      </PageIntro>
      <div className="article-layout">
        <article>
          <Prose blocks={blocks} />
          {children}
        </article>
        {toc.length > 1 ? (
          <nav className="article-toc no-print" aria-label="In this article">
            <h2>In this article</h2>
            <ul>
              {toc.map((heading) => (
                <li key={heading.id} className={heading.level === 3 ? "toc-3" : undefined}>
                  <a href={`#${heading.id}`}>{heading.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </main>
  );
}
