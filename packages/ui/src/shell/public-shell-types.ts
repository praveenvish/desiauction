import type { ElementType, ReactNode } from "react";

/**
 * Public shell prop types, extracted so the shell and its mobile menu can both
 * depend on them WITHOUT importing each other — breaking a module cycle that the
 * `no-circular` gate (depcruise) rejects. `public-shell.tsx` re-exports these, so
 * the package's public surface (`@desiauction/ui`) is unchanged.
 */

export interface PublicShellLink {
  label: string;
  href: string;
  /** A grouped header nav item (e.g. "Resources ▾") — renders as a dropdown. */
  children?: PublicShellLink[];
  /** This link IS the page being viewed: renders `aria-current="page"`. The
      shell cannot work this out for itself — it never sees the route — so the
      app marks it. */
  active?: boolean;
}

export interface PublicShellFooterGroup {
  label: string;
  links: PublicShellLink[];
}

export interface PublicShellProps {
  wordmark: ReactNode;
  wordmarkHref?: string;
  /** The mark rendered in the wordmark chip. Defaults to the built-in glyph so
      packages/ui carries no asset of its own; the app passes the real logo. */
  glyph?: ReactNode;
  /** Header links (only ones that exist — no dead links, PX-2 ruling). */
  nav?: PublicShellLink[];
  /** Right-side header slot: Sign in / user chip. */
  headerAction?: ReactNode;
  footerLinks?: PublicShellLink[];
  /** Columned footer (preferred). When present, `footerLinks` is ignored. */
  footerGroups?: PublicShellFooterGroup[];
  /** Short brand line rendered beside the footer wordmark. */
  footerTagline?: ReactNode;
  /** Decorative row rendered under the footer tagline (e.g. social glyphs). */
  footerSocial?: ReactNode;
  /** A 5th footer column slot (e.g. a newsletter signup form). */
  footerNewsletter?: ReactNode;
  footerNote?: ReactNode;
  /** Small links rendered beside footerNote in the bottom bar (Privacy, Terms, …). */
  footerBottomLinks?: PublicShellLink[];
  /**
   * Drop the columned footer for the bottom bar alone.
   *
   * For CONVERSION surfaces. The full footer is a sitemap plus a newsletter
   * subscribe — 1019px of it at 390, 1455px at 320 — and under a sign-in form
   * that is a bigger, more distracting surface than the form itself. The header
   * stays, so the rest of the site is still one tap away; what goes is the
   * invitation to go read about careers instead of signing in.
   */
  footerCompact?: boolean;
  /**
   * Let the content row grow into the space the header left, so a page can say
   * `flex: 1` instead of subtracting a header height it cannot see. The
   * arithmetic version is always off by the difference between the header's
   * declared height and what its scroll-timeline keyframe actually paints.
   */
  contentFill?: boolean;
  linkComponent?: ElementType;
  children: ReactNode;
}
