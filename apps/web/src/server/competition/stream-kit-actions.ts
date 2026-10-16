"use server";

import { env } from "../../env";
import { currentSession } from "../auth/actions";
import { publicCompetitionView } from "./public";
import { streamKit, type StreamKit } from "./stream-kit";

/**
 * The stream kit for a season, or null when it has none to give: signed out,
 * or the season is not published (its public page, which the text links to,
 * does not exist). It reads ONLY the public season view, so it can return
 * nothing the season page itself would not show anyone.
 */
export async function streamKitView(slug: string): Promise<StreamKit | null> {
  if ((await currentSession()) === null) {
    return null;
  }
  const season = await publicCompetitionView(slug);
  if (season === null) {
    return null;
  }
  return streamKit({
    name: season.name,
    slug: season.slug,
    place: season.venue?.city ?? season.location,
    teamCount: season.teams.length,
    base: env.PUBLIC_BASE_URL.replace(/\/+$/, ""),
  });
}
