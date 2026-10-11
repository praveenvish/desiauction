import { publicFamilyPanel } from "@desiauction/core/scoring";
import { fixtures, matches, matchLiveState, people, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { scoringSetup, scoringSetupProjection } from "./home";
import { resumeScoring } from "./claim";
import { scoringNames, matchAgeDate } from "./live-state";
/** Provision first; all work after the shared history lock is read-only. */
export async function prepareScoring(db: Db, fixtureId: string, actorId: string) {
  const preliminary = await scoringSetup(db, fixtureId, actorId);
  if (!preliminary) return { ok: false as const, error: "not_found", message: "Match not found." };
  const [existing] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
  if (!existing) {
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture || fixture.status !== "published")
      return { ok: false as const, error: "not_found", message: "Match not found." };
    const [person] = await db
      .select({ language: people.language })
      .from(people)
      .where(eq(people.id, actorId));
    const names = await scoringNames(
      db,
      fixture.competitionId,
      matchAgeDate(fixture.kickoffAt, new Date()),
    );
    return {
      ok: true as const,
      events: [],
      lastSeq: 0,
      attempt: null,
      preparation: "unstarted" as const,
      bootstrap: {
        actorId,
        names,
        setup: preliminary,
        language: person?.language ?? "en",
        sharePath: `/score/${fixtureId}`,
        nextMatch: null,
      },
    };
  }
  const history = await resumeScoring(db, fixtureId, actorId, 0);
  if (!history.ok) return history;
  const setup = await scoringSetupProjection(db, fixtureId, actorId);
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
  if (!setup || !fixture || !match)
    return { ok: false as const, error: "not_found", message: "Match not found." };
  const [person] = await db
    .select({ language: people.language })
    .from(people)
    .where(eq(people.id, actorId));
  const names = await scoringNames(
    db,
    fixture.competitionId,
    matchAgeDate(fixture.kickoffAt, match.startedAt),
  );
  const [snapshot] = await db
    .select({ state: matchLiveState.state })
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, fixtureId));
  const state = snapshot?.state;
  const hasInnings =
    state !== null &&
    state !== undefined &&
    typeof state === "object" &&
    "innings" in state &&
    Array.isArray(state.innings) &&
    state.innings.length > 0;
  const panel = publicFamilyPanel(state);
  const hasRally = panel?.family === "rally" && panel.panel.rubbers.length > 0;
  const hasTimed = panel?.family === "timed" && panel.panel.period > 0;
  const hasPlacement = panel?.family === "placement" && panel.panel.round > 0;
  const terminal = [
    "result_reached",
    "finished",
    "final",
    "no_result",
    "abandoned",
    "walkover",
  ].includes(match.phase);
  return {
    ...history,
    preparation:
      !hasInnings && !hasRally && !hasTimed && !hasPlacement && !terminal
        ? ("unstarted" as const)
        : ("started" as const),
    bootstrap: {
      actorId,
      names,
      setup,
      language: person?.language ?? "en",
      sharePath:
        setup.visibility === "public"
          ? `/c/${setup.competitionSlug}/m/${setup.fixtureNumber}`
          : `/m/${match.shareToken}`,
      nextMatch: null,
    },
  };
}
