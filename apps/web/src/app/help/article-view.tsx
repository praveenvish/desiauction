import Link from "next/link";
import { IconArrowLeft } from "@desiauction/ui";

import { PageBody, PageHero } from "../../components/public/public-kit";
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
      <PageHero
        size="compact"
        eyebrow={
          <Link href={backHref} className="article-back no-print">
            {/* The two page files already hide the glyph; this shared component
                did not, so a screen reader read the arrow character aloud. */}
            <IconArrowLeft size={16} className="icon-lead" /> {backLabel}
          </Link>
        }
        title={title}
        {...(meta === undefined ? {} : { lede: meta })}
      />
      <PageBody>
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
      </PageBody>
    </main>
  );
}
