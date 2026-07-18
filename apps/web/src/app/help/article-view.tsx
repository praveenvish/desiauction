import Link from "next/link";

import { Prose, tocOf, type Block } from "../../content/blocks";

/**
 * PX-10 shared article layout: prose with an "In this article" table of contents
 * that becomes sticky beside the text above 1024px (PX-1 06 P-03). Pure
 * presentation — it renders the blocks it's given.
 */
export function ArticleView({
  title,
  meta,
  blocks,
  backHref = "/help",
  backLabel = "All help",
}: {
  title: string;
  meta?: string;
  blocks: readonly Block[];
  backHref?: string;
  backLabel?: string;
}) {
  const toc = tocOf(blocks);
  return (
    <main className="content-page">
      <p className="article-meta no-print">
        <Link href={backHref} className="prose-link">
          ← {backLabel}
        </Link>
      </p>
      <h1>{title}</h1>
      {meta !== undefined ? <p className="article-meta">{meta}</p> : null}
      <div className="article-layout">
        <article>
          <Prose blocks={blocks} />
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
