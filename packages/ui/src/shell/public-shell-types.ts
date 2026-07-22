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
}

export interface PublicShellFooterGroup {
  label: string;
  links: PublicShellLink[];
}

export interface PublicShellProps {
  wordmark: ReactNode;
  wordmarkHref?: string;
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
  linkComponent?: ElementType;
  children: ReactNode;
}
