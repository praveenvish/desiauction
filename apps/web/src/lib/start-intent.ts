/**
 * WHERE "CREATE YOUR TOURNAMENT" GOES.
 *
 * The landing CTA used to be a bare /login: the visitor signed up, named
 * themselves, and was then asked "Run a tournament, or play in one?" — the
 * question they had answered by clicking. The intent now rides through
 * sign-in and onboarding as `next`, and /home opens the create-club dialog.
 */
export const START_CLUB_PATH = "/home?start=club";

export const START_CLUB_LOGIN = `/login?next=${encodeURIComponent(START_CLUB_PATH)}`;

/** True when the visitor came to start a club, so the sign-in can say so. */
export function isStartClub(next: string | undefined): boolean {
  return next === START_CLUB_PATH;
}

/**
 * A player who tapped a season's registration link (usually from WhatsApp)
 * was greeted with "Sign in to continue where you were headed" — true, and no
 * help to someone who came to register for a tournament.
 */
export function isRegisterNext(next: string | undefined): boolean {
  return next !== undefined && /^\/seasons\/[^/?#]+\/register(?:[?#]|$)/.test(next);
}
