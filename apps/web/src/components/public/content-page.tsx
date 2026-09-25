/**
 * THE CONTENT PAGE — About, Security, Rules, Contact, Support, Legal, the
 * release notes, and the four pages that have nothing on them yet.
 *
 * Each of these had grown its own opening: some had a kicker, some did not,
 * two had a lead paragraph in a different size, and none had the band the rest
 * of the public site opens with. A visitor crossing from /help to /about could
 * see the seam. One component now owns that opening, and each page supplies
 * only what is true of it.
 */
import type { ReactNode } from "react";

import { ContentLayout, type ContentAnchor } from "./content-layout";
import { PageBody, PageHero } from "./public-kit";

export function ContentPage({
  eyebrow,
  title,
  lede,
  anchors,
  meta,
  related,
  relatedTitle,
  foot,
  aside,
  actions,
  prose,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  anchors?: ContentAnchor[];
  meta?: ReactNode;
  related?: ReactNode;
  relatedTitle?: string;
  foot?: ReactNode;
  /** The right-hand column beside the text (see ContentLayout). */
  aside?: ReactNode;
  /** Buttons in the title band. */
  actions?: ReactNode;
  /** False when the main column is components, not a document. */
  prose?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="content-page">
      <PageHero
        size="compact"
        {...(eyebrow === undefined ? {} : { eyebrow })}
        title={title}
        {...(lede === undefined ? {} : { lede })}
        {...(actions === undefined ? {} : { actions })}
      />
      <PageBody>
        <ContentLayout
          {...(anchors === undefined ? {} : { anchors })}
          {...(meta === undefined ? {} : { meta })}
          {...(related === undefined ? {} : { related })}
          {...(relatedTitle === undefined ? {} : { relatedTitle })}
          {...(foot === undefined ? {} : { foot })}
          {...(aside === undefined ? {} : { aside })}
          {...(prose === undefined ? {} : { prose })}
        >
          {children}
        </ContentLayout>
      </PageBody>
    </main>
  );
}
