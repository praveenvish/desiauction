import { redirect } from "next/navigation";

import { currentSession } from "./actions";
import { safeNext } from "./redirect";

/**
 * The name gate — the ONE thing onboarding asks for — enforced across the
 * console instead of on a single page.
 *
 * It used to live only in `/home`. Every other console route let a nameless
 * account straight through, and because a signed-out visit redirects via
 * `?next=<route>`, BYPASSING WAS THE DEFAULT for anyone who deep-linked:
 * `/login?next=/orgs` verified, landed on /orgs, and never saw onboarding
 * again. Those accounts then appear as a raw phone number on team sheets,
 * receipts and settlement records — permanently, with no prompt ever shown.
 *
 * What it deliberately does NOT do is gate on the session. Sign-in stays with
 * each page, which is what lets every route carry its own `next` back to
 * exactly where the visitor was headed. This adds one condition on top: a
 * session that exists but has no name owes the product one question first.
 */
export async function requireOnboarded(next?: string): Promise<void> {
  const session = await currentSession();
  if (session !== null && (session.name === null || session.name.trim() === "")) {
    // INTERRUPT ONCE, THEN PUT THEM BACK. The gate always sent people to /home
    // afterwards, which is fine for a rail click and wrong for the live auction
    // room: an owner arriving straight off `acceptOwnerJoin` would be asked for
    // their name and then landed somewhere else entirely, mid-auction. Segments
    // that know where they are pass it; `next` is attacker-reachable in general
    // so it goes through the same PX-11 allowlist as the login one.
    redirect(
      next === undefined ? "/onboarding" : `/onboarding?next=${encodeURIComponent(safeNext(next))}`,
    );
  }
}
