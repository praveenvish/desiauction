import { withTenantDb, fixtures, matches, people, registrations } from "@desiauction/db";
import { eq, and, inArray } from "drizzle-orm";
import { styleLabel } from "@desiauction/core";
import { aggregateFacts, withSample } from "../../../server/insights/sample";
import { slowestBowlingMatchup } from "../../../server/insights/batter";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { MatchEvent } from "@desiauction/core/scoring";
import { currentSession } from "../../../server/auth/actions";
import { dbHandle } from "../../../server/db";
import {
  scoringOrgIds,
  scoringSetup,
  scoringHomeForPerson,
  scoringDay,
} from "../../../server/scoring/home";
import { resumeScoring } from "../../../server/scoring/claim";
import { mayScore } from "../../../server/scoring/authority";
import { matchAgeDate, scoringNames } from "../../../server/scoring/live-state";
import {
  DeliveryPadEntry,
  RallyPadEntry,
  RaidPadEntry,
  TimedPadEntry,
  PlacementPadEntry,
} from "./families/pad-entries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scoring pad", robots: { index: false, follow: false } };
export default async function ScoringPadPage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  const { fixtureId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/score/${fixtureId}`)}`);
  for (const orgId of await scoringOrgIds(session.personId)) {
    const loaded = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId },
      async (db) => {
        const setup = await scoringSetup(db, fixtureId, session.personId);
        if (!setup) return null;
        const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
        if (!fixture || !(await mayScore(db, session.personId, fixture))) return null;
        const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
        if (!match) return { setupOnly: true as const };
        const events: MatchEvent[] = [];
        let since = 0;
        for (;;) {
          const page = await resumeScoring(db, fixtureId, session.personId, since);
          if (!page.ok) return null;
          events.push(...page.events);
          const last = page.events.at(-1);
          if (page.lastSeq <= (last?.seq ?? since)) break;
          if (!last || last.seq <= since) throw new Error("Scoring history did not advance");
          since = last.seq;
        }
        const [person] = await db
          .select({ language: people.language })
          .from(people)
          .where(eq(people.id, session.personId));
        const names = await scoringNames(
          db,
          fixture.competitionId,
          matchAgeDate(fixture.kickoffAt, match.startedAt),
        );
        const playerIds = Object.keys(names.players);
        const identities = playerIds.length
          ? await db
              .select({ id: registrations.id, personId: registrations.personId })
              .from(registrations)
              .where(
                and(
                  eq(registrations.competitionId, fixture.competitionId),
                  inArray(registrations.id, playerIds),
                ),
              )
          : [];
        const matchupHints: Record<string, string> = {};
        for (const identity of setup.family === "delivery" ? identities : []) {
          const rows = await aggregateFacts(
            db,
            { kind: "self", personId: identity.personId },
            "batting",
            "bowler_style",
          );
          const matchup = slowestBowlingMatchup({
            bowlingTypes: rows.map((row) => ({
              ...withSample(row),
              strikeRate: row.balls ? (row.runs * 100) / row.balls : null,
            })),
          });
          if (matchup) {
            const name = names.players[identity.id]?.name ?? "Player";
            matchupHints[identity.id] =
              `${name} scores slowest against ${styleLabel(matchup.style) ?? matchup.style}: ${matchup.rate.toFixed(1)} an over in ${String(matchup.sample.matches)} matches`;
          }
        }
        return {
          setupOnly: false as const,
          events,
          names,
          matchupHints,
          setup,
          language: person?.language ?? "en",
          sharePath:
            setup.visibility === "public"
              ? `/c/${setup.competitionSlug}/m/${setup.fixtureNumber}`
              : `/m/${match.shareToken}`,
        };
      },
    );
    if (!loaded) continue;
    if (loaded.setupOnly) redirect(`/score/${fixtureId}/setup`);
    const nextMatch = (await scoringHomeForPerson(session.personId)).find(
      (candidate) =>
        candidate.fixtureId !== fixtureId && candidate.kickoffAt?.slice(0, 10) === scoringDay(),
    );
    if (loaded.setup.family === "placement")
      return (
        <PlacementPadEntry
          fixtureId={fixtureId}
          actorId={session.personId}
          events={loaded.events}
          names={loaded.names}
          setup={loaded.setup}
          sharePath={loaded.sharePath}
          nextMatch={nextMatch ? `/score/${nextMatch.fixtureId}` : null}
          language={loaded.language}
        />
      );
    if (loaded.setup.family === "timed")
      return (
        <TimedPadEntry
          fixtureId={fixtureId}
          actorId={session.personId}
          events={loaded.events}
          names={loaded.names}
          setup={loaded.setup}
          sharePath={loaded.sharePath}
          nextMatch={nextMatch ? `/score/${nextMatch.fixtureId}` : null}
          language={loaded.language}
        />
      );
    if (loaded.setup.family === "raid")
      return (
        <RaidPadEntry
          fixtureId={fixtureId}
          actorId={session.personId}
          events={loaded.events}
          names={loaded.names}
          setup={loaded.setup}
          sharePath={loaded.sharePath}
          nextMatch={nextMatch ? `/score/${nextMatch.fixtureId}` : null}
        />
      );
    if (loaded.setup.family === "rally")
      return (
        <RallyPadEntry
          fixtureId={fixtureId}
          actorId={session.personId}
          events={loaded.events}
          names={loaded.names}
          setup={loaded.setup}
          sharePath={loaded.sharePath}
          nextMatch={nextMatch ? `/score/${nextMatch.fixtureId}` : null}
        />
      );
    return (
      <DeliveryPadEntry
        key={fixtureId}
        fixtureId={fixtureId}
        actorId={session.personId}
        events={loaded.events}
        names={loaded.names}
        matchupHints={loaded.matchupHints}
        setup={loaded.setup}
        language={loaded.language}
        sharePath={loaded.sharePath}
        nextMatch={nextMatch ? `/score/${nextMatch.fixtureId}` : null}
      />
    );
  }
  notFound();
}
