import { notFound } from "next/navigation";

/**
 * THE APP OWNS ITS OWN 404 INSTEAD OF LETTING NEXT INVENT ONE.
 *
 * There are two kinds of 404 here and they behaved very differently.
 *
 * `/help/not-a-real-article` matches a real route — `help/[slug]` — which looks
 * the article up, does not find it, and calls `notFound()`. The router's state
 * tree keeps its shape, because a real route rendered.
 *
 * `/pricing/nonsense` matched NOTHING, so Next served its own synthetic
 * `/_not-found` route. That route carries no parallel slots, so the state tree
 * it handed the client had only `children` — no `action`, the slot the root
 * layout declares. Every prefetch the router then fired for the links in the
 * shell came back carrying that tree, and Next walked it:
 *
 *     if (subPath[0] === DEFAULT_SEGMENT_KEY && flightRouterState &&
 *         !!flightRouterState[1][parallelRouteKey][0] && …)
 *         // next/dist/server/app-render/walk-tree-with-flight-router-state.js
 *
 * `flightRouterState[1]["action"]` is undefined, `[0]` of undefined throws, and
 * the request 500s. ONE MISTYPED ADDRESS PRODUCED TWENTY-ONE SERVER ERRORS —
 * one per link in the header and footer. A typo is the commonest 404 there is.
 *
 * It survived because nothing failed visibly: a prefetch that dies is retried
 * as a hard navigation, so the visitor still got where they were going. What it
 * cost was every onward link becoming a full page load, and twenty-one invented
 * 500s per typo in the server log and in Sentry — enough noise to bury a real
 * outage. `public-experience.spec.ts` even had a test called "no crash" that
 * could not see it: it watched the document response, and these are the
 * prefetches that follow it.
 *
 * This route makes the first kind of 404 the only kind. An unmatched address
 * now resolves HERE, a real page under the real root layout, so the `@action`
 * slot resolves the way it does everywhere else and the tree the client gets is
 * the same shape as on any other page. `notFound()` then renders the same
 * branded `not-found.tsx` with the same 404 status, so nothing about what a
 * visitor sees has changed.
 *
 * REQUIRED catch-all, not optional: `[[...missing]]` would also match `/` and
 * fight `app/page.tsx` for the landing page. Static and dynamic segments both
 * outrank a catch-all in Next's matching, so no existing route is shadowed.
 */
export default function MissingPage(): never {
  notFound();
}
