"use client";

import { createContext, useContext, useEffect } from "react";

/**
 * Title override for the shell's identity bar.
 *
 * `pageIdentity` (nav.ts) answers "where am I" for every console route from the
 * URL and the names the shell already holds. A few titles are page data it
 * cannot know — a tournament's name, an admin record, a finance document — and
 * those pages publish theirs here. The derived label ("Tournament", "User")
 * paints first and is true; this replaces it once the page mounts.
 *
 * Deliberately NOT a general escape hatch: a page that publishes a name the
 * shell could have derived is re-introducing the drift the identity bar exists
 * to remove.
 */

export interface ShellTitleOverride {
  /** null hides the shell's title entirely — see `PageTitleHidden`. */
  title: string | null;
  /** Test hook for the h1, for suites that used to drive the page's own. */
  testId?: string;
  /** The header's line two, where the lede is data rather than fixed copy. */
  subtitle?: string;
}

export interface ShellTitleChannel {
  /** Both are state setters or closures over one — stable across renders. */
  publish: (value: ShellTitleOverride) => void;
  /**
   * Clear, but only if `token` is STILL what is published.
   *
   * A route-level `loading.tsx` (or any Suspense re-reveal) can mount the page,
   * mount it again, and only then run the first instance's cleanup — an
   * unconditional clear would land last and blank a title that the live
   * instance had already set. Comparing identity makes the teardown
   * order-independent, and does the same job during a route change, where the
   * outgoing page's cleanup would otherwise wipe the incoming page's title.
   */
  retract: (token: ShellTitleOverride) => void;
}

export const ShellTitleContext = createContext<ShellTitleChannel>({
  publish: () => {},
  retract: () => {},
});

export interface PageTitleProps {
  title: string;
  testId?: string;
  subtitle?: string;
}

/** Renders nothing: it hands the page's name up to the identity bar. */
export function PageTitle({ title, testId, subtitle }: PageTitleProps) {
  const { publish, retract } = useContext(ShellTitleContext);
  useEffect(() => {
    const token: ShellTitleOverride = {
      title,
      ...(testId !== undefined ? { testId } : {}),
      ...(subtitle !== undefined ? { subtitle } : {}),
    };
    publish(token);
    return () => {
      retract(token);
    };
  }, [publish, retract, title, testId, subtitle]);
  return null;
}

/**
 * Silences the identity bar's title for a body that brings its own h1 — the
 * 404, which must stay the page's only heading no matter which route dead-ended.
 */
export function PageTitleHidden() {
  const { publish, retract } = useContext(ShellTitleContext);
  useEffect(() => {
    const token: ShellTitleOverride = { title: null };
    publish(token);
    return () => {
      retract(token);
    };
  }, [publish, retract]);
  return null;
}
