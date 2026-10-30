/**
 * IS THE `@action` SLOT SHOWING THE PAGE WE ARE ON, OR THE LAST ONE THAT HAD AN ACTION?
 *
 * On a client-side navigation Next keeps an unmatched parallel slot showing
 * whatever it last rendered: `default.tsx` only answers a HARD load. Clicking
 * from a season's Teams to its Registrations kept "+ Add team" in the page
 * head, and /tournaments' "+ New tournament" followed an organizer into their
 * season.
 *
 * That used to be fixed with a catch-all slot page (`@action/[...missing]`) so
 * every address matched and the slot re-rendered to nothing. But a catch-all in
 * ANY slot is a root route, so no address was ever unmatched: a mistyped URL
 * reached `notFound()` from a page instead of Next's own `/_not-found`, and a
 * page-level `notFound()` is served as an empty error shell that only the
 * browser can fill in. ~1 in 10 of those stayed blank.
 *
 * The router already knows which page the slot was rendered for: its segments.
 * A stale slot is one whose segments are not the current path's, and it is
 * hidden instead of re-rendered.
 */
export function actionSlotIsCurrent(
  slotSegments: readonly string[] | null,
  pathname: string,
): boolean {
  if (slotSegments === null) return false;
  // Route groups name folders, not addresses.
  const slot = slotSegments.filter((segment) => !segment.startsWith("(")).map(decodeSegment);
  const path = pathname.split("/").filter(Boolean).map(decodeSegment);
  return slot.length === path.length && slot.every((segment, index) => segment === path[index]);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
