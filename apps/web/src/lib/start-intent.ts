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
  return homeIntentFromNext(next)?.includes("start=club") === true;
}

/**
 * A player who tapped a season's registration link (usually from WhatsApp)
 * was greeted with "Sign in to continue where you were headed" — true, and no
 * help to someone who came to register for a tournament.
 */
export function isRegisterNext(next: string | undefined): boolean {
  return next !== undefined && /^\/seasons\/[^/?#]+\/register(?:[?#]|$)/.test(next);
}

/** Canonical Home intent; repeated query values never become a selected scope. */
export function homeIntentPath(params: Record<string, string | string[] | undefined>): string {
  const retained = new URLSearchParams();
  if (params.start === "club") retained.set("start", "club");
  if (typeof params.season === "string") retained.set("season", params.season);
  return retained.size > 0 ? `/home?${retained.toString()}` : "/home";
}

/** Call after safeNext. Only the exact Home route owns these parameters. */
export function homeIntentFromNext(next: string | undefined): string | null {
  if (next === "/home") return "/home";
  if (next === undefined || !next.startsWith("/home?")) return null;
  const query = new URLSearchParams(next.slice(6).split("#")[0]);
  const scalar = (key: string): string | undefined => {
    const values = query.getAll(key);
    return values.length === 1 ? values[0] : undefined;
  };
  return homeIntentPath({ start: scalar("start"), season: scalar("season") });
}
