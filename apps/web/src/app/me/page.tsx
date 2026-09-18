import { sportPackFor } from "@desiauction/core";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { myRegistrations } from "../../server/competition/public";

/**
 * /me — the door the rail's "My sports" opens.
 *
 * The career lives per sport (`/me/{sport}`), and there was no index: `/me`
 * fell through to the 404. Until the all-sports hub replaces this (Phase 3),
 * it opens the sport this person most recently entered — the same choice
 * /home's career link makes — and cricket for someone with no season yet.
 */
export default async function MeIndex(): Promise<never> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/me");
  }
  const mine = await myRegistrations(session.personId);
  // Ordered by start date ascending, so the most recent season is last.
  const sport = sportPackFor(mine[mine.length - 1]?.sport ?? null).key;
  redirect(`/me/${sport}`);
}
