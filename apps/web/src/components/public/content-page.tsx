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
import { PageBody, PageHero, SportMontage } from "./public-kit";

export function ContentPage({
  eyebrow,
  title,
  lede,
  /** Art for the band. `montage` is the site-wide five-sport strip. */
  art = "none",
  anchors,
  meta,
  related,
  relatedTitle,
  foot,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  art?: "none" | "montage";
  anchors?: ContentAnchor[];
  meta?: ReactNode;
  related?: ReactNode;
  relatedTitle?: string;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="content-page">
      <PageHero
        size="compact"
        {...(eyebrow === undefined ? {} : { eyebrow })}
        title={title}
        {...(lede === undefined ? {} : { lede })}
        {...(art === "montage" ? { art: <SportMontage /> } : {})}
      />
      <PageBody>
        <ContentLayout
          {...(anchors === undefined ? {} : { anchors })}
          {...(meta === undefined ? {} : { meta })}
          {...(related === undefined ? {} : { related })}
          {...(relatedTitle === undefined ? {} : { relatedTitle })}
          {...(foot === undefined ? {} : { foot })}
        >
          {children}
        </ContentLayout>
      </PageBody>
    </main>
  );
}
