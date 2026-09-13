import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "@desiauction/ui";

import { PageIntro } from "./page-intro";

/**
 * An honest empty page, designed once. Blog, case studies, the API docs and
 * careers all say the same true thing — nothing here yet, and here is why —
 * and each used to hand-write it as a heading, a paragraph and a muted line.
 * One shape now: the intro, then a card that reads as a deliberate state
 * rather than a page that failed to load. No fabricated posts, roles or
 * endpoints: the copy is the page's own, this only dresses it.
 */
export function PlaceholderPage({
  title,
  lead,
  icon: Icon,
  note,
  children,
}: {
  title: string;
  lead: ReactNode;
  icon: ComponentType<IconProps>;
  /** The one-line state, e.g. "Nothing published yet." */
  note: ReactNode;
  /** The door out — a mailto, a link — rendered under the note. */
  children?: ReactNode;
}) {
  return (
    <main className="content-page content-narrow">
      <PageIntro title={title} lead={lead} />
      <div className="content-placeholder" role="note">
        <span className="content-icon-tile" aria-hidden="true">
          <Icon size={22} />
        </span>
        <p className="content-placeholder-note">{note}</p>
        {children !== undefined ? <div className="content-placeholder-door">{children}</div> : null}
      </div>
    </main>
  );
}
