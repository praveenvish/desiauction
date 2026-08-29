import { flushSync } from "react-dom";

/**
 * A SAME-DOCUMENT VIEW TRANSITION, ON STABLE REACT.
 *
 * Cross-ROUTE transitions — the card that morphs into its own detail page — are
 * not available to this app. Next 15.5's `experimental.viewTransition` flag
 * enables React's `<ViewTransition>` component, React 19.2.7 does not ship one
 * (`unstable_ViewTransition` is undefined), and the flag alone wraps no
 * navigation: probed on a production build, a real in-app navigation called
 * `document.startViewTransition` exactly zero times. Getting there means the
 * React experimental channel, which is not a dependency a platform holding
 * settlement figures should take for an animation.
 *
 * What IS available is the native API for updates that happen WITHIN a page,
 * and it needs no framework support at all. `flushSync` is the load-bearing
 * part: `startViewTransition` snapshots the DOM, runs the callback, then
 * snapshots again — so the update has to land synchronously inside it or the
 * browser captures two identical frames and animates nothing.
 *
 * Fails open in every direction. No support (Firefox today), reduced motion, or
 * a callback that throws: the update still happens, unanimated. A transition is
 * decoration, and decoration may never be the reason a control stops working.
 */
export function withViewTransition(update: () => void): void {
  const doc: Document & {
    startViewTransition?: (callback: () => void) => { finished?: Promise<void> };
  } = document;

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (typeof doc.startViewTransition !== "function" || reduced) {
    update();
    return;
  }

  try {
    doc.startViewTransition(() => {
      flushSync(update);
    });
  } catch {
    // A browser that advertises the API and then refuses the call still owes
    // the user their state change.
    update();
  }
}
