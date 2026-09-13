import { IconArrowLeft } from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one way a content page introduces itself: an optional way back, an
 * optional eyebrow, the title, and a lead. Before this every content page
 * hand-wrote the same three tags with slightly different spacing — the help
 * index had a kicker, the legal index did not, releases had a lead with a
 * version in it — so the public site had five subtly different top-of-page
 * rhythms. The classes live in content.css; the eyebrow is the same mark the
 * marketing pages use, without importing their stylesheet.
 */
export function PageIntro({
  kicker,
  title,
  lead,
  back,
  children,
}: {
  kicker?: string;
  title: string;
  lead?: ReactNode;
  back?: { href: string; label: string };
  /** Anything that belongs with the intro — a meta line, a search form. */
  children?: ReactNode;
}) {
  return (
    <header className="content-intro">
      {back !== undefined ? (
        <p className="article-meta no-print">
          <Link href={back.href} className="prose-link">
            <IconArrowLeft size={16} className="icon-lead" /> {back.label}
          </Link>
        </p>
      ) : null}
      {kicker !== undefined ? <p className="content-kicker">{kicker}</p> : null}
      <h1>{title}</h1>
      {lead !== undefined ? <p className="content-lead">{lead}</p> : null}
      {children}
    </header>
  );
}
