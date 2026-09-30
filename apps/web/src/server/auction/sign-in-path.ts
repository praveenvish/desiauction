// Its own module, not the "use server" file beside it: that file may export
// only async server actions, and this is neither async nor an action.

/**
 * Where somebody who has to sign in again is sent back to.
 *
 * It was a bare `/login`, which lands on `/home` afterwards. For an owner whose
 * session ended in the middle of a night — signed out on another device, a
 * cleared cookie — that meant signing in and then finding the auction again
 * from the dashboard while lots went by. The season's auction page is the door
 * to every room in it (live, cockpit, spectate), so that is where they return.
 *
 * The slug is the caller's, so it is held to the shape a slug has before it is
 * put in a URL; anything else gets the plain door.
 */
export function signInPathFor(slug: string): string {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
    ? `/login?next=${encodeURIComponent(`/seasons/${slug}/auction`)}`
    : "/login";
}
