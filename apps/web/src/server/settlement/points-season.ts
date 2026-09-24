/**
 * Why every settlement command refuses on a points season (0091). Its own
 * module because `actions.ts` is `"use server"`, where every export must be an
 * async function.
 */
export const POINTS_SEASON_REFUSAL =
  "This is a points season — no money changes hands, so there is nothing to settle.";
