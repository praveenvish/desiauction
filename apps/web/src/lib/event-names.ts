/**
 * EVENT NAMES BOTH CONSOLES PRINT — one source.
 *
 * The organizer feed (app/home/home-activity.tsx) and the platform admin
 * (app/admin/admin-ui.tsx) each humanise audit action codes in their own
 * voice. An event whose mechanical fallback read differently on the two
 * ("Registration poster generated" vs "Made a player poster", round-5
 * review) is named here once and both maps read it.
 */
export const SHARED_EVENT_NAMES: Readonly<Record<string, string>> = {
  "registration.poster_generated": "Made a player poster",
  "team.poster_generated": "Made a team poster",
  "season.poster_generated": "Made a season poster",
};
