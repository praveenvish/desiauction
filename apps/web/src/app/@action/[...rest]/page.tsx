/**
 * EVERY OTHER ROUTE, MATCHED EXPLICITLY — so a soft navigation clears the slot.
 *
 * `default.tsx` only answers a HARD load. On a client-side navigation Next
 * keeps an unmatched parallel slot showing whatever it last rendered, so
 * clicking from Teams to Registrations kept "+ Add team" in the page head (and
 * /tournaments' "+ New tournament" followed an organizer into their season).
 * A catch-all is a match, so the slot re-renders — to nothing. The specific
 * slot pages (home, orgs, tournaments, a season's teams) still win over it.
 */
export default function NoActionHere() {
  return null;
}
