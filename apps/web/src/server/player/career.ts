import {
  auctions,
  competitions,
  fixtureLineups,
  fixtureResults,
  messageOutbox,
  fixtures,
  grounds,
  lots,
  organizations,
  registrations,
  teams,
  tournaments,
} from "@desiauction/db";
import { sportPackFor, type MoneyUnit } from "@desiauction/core";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { isPreSigned, preSignedKind, type PreSignedKind } from "../../lib/pre-signed";
import { systemDb } from "../db";
import { standingsOf } from "../competition/results";

/**
 * THE PLAYER'S CAREER (PI-1 P5) — the read the data has been waiting for.
 *
 * Person-scoped cross-org listing on the system pool (the myRegistrations /
 * PRP-1 documented class). The person id comes from the SESSION at every call
 * site and never from a client parameter — the same contract the profile
 * module carries, held by its regression test.
 *
 * This is a projection over certified writers, never a table: registrations
 * (participation + season snapshot), teams (squad via the auction's own
 * `team_id` stamp), tournaments (durable names over editions), lots (the
 * verdict and the price). Nothing here can drift from the record because
 * nothing here IS a record.
 *
 * Prices are the PERSON'S OWN — this module serves the self view (/me).
 * The public career section renders only what the public player page already
 * shows, through its own gated reader in competition/public.ts.
 */

export interface CareerSeason {
  registrationId: string;
  competitionName: string;
  competitionSlug: string;
  /** The season's sport pack key — the hub groups and filters by it. */
  sport: string;
  /** The durable tournament name this season is an edition of, if any. */
  tournamentName: string | null;
  orgName: string;
  /** Competition start date (ISO) — the career's ordering key. */
  startsOn: string | null;
  /** Competition end date (ISO) — past it, a season is over for its player. */
  endsOn: string | null;
  /** The season's auction, if one was set up (never an abandoned one). */
  auctionStatus: string | null;
  role: string | null;
  status: string;
  teamName: string | null;
  /** The team's own colour, for its chip — null when the club set none. */
  teamColor: string | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  jerseyNumber: string | null;
  /** What this season's sold price counts in (0091) — rupees or points. */
  auctionUnit: MoneyUnit;
  /** How the auction concluded for this person, if one did. */
  auction:
    { kind: PreSignedKind } | { kind: "sold"; soldPrice: number } | { kind: "unsold" } | null;
}

export interface PlayerCareer {
  seasons: CareerSeason[];
  totals: {
    seasons: number;
    teams: number;
    soldCount: number;
    /**
     * The dearest RUPEE sale; only when there is none, the dearest points
     * sale (0091). Points and rupees are never compared — 10,000 pts is not
     * a bigger price than ₹5,000.
     */
    highestPrice: number | null;
    /** What `highestPrice` counts in. */
    highestUnit: MoneyUnit;
  };
}

/** Seasons per page on /me — plenty for a local career, honest beyond it. */
export const CAREER_PAGE_SIZE = 50;

export async function playerCareer(personId: string, sport?: string): Promise<PlayerCareer> {
  const rows = await systemDb
    .select({
      registrationId: registrations.id,
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      sport: competitions.sport,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      auctionStatus: auctions.status,
      tournamentName: tournaments.name,
      orgName: organizations.name,
      role: registrations.role,
      status: registrations.status,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
      isCaptain: registrations.isCaptain,
      isViceCaptain: registrations.isViceCaptain,
      jerseyNumber: registrations.jerseyNumber,
      teamName: teams.name,
      teamColor: teams.primaryColor,
      teamFranchiseId: teams.franchiseId,
      lotStatus: lots.status,
      soldPrice: lots.soldPrice,
      auctionUnit: competitions.auctionUnit,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .leftJoin(tournaments, eq(tournaments.id, competitions.tournamentId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    // The abandoned-auction trap, documented at myRegistrations: abandoned
    // nights accumulate lots without limit, so the join goes THROUGH the one
    // auction that counts or a career would list phantom verdicts.
    .leftJoin(
      auctions,
      and(
        eq(auctions.competitionId, registrations.competitionId),
        ne(auctions.status, "abandoned"),
      ),
    )
    .leftJoin(lots, and(eq(lots.registrationId, registrations.id), eq(lots.auctionId, auctions.id)))
    .where(
      and(
        eq(registrations.personId, personId),
        // One sport's career, when the page is about one sport (Phase 3). A
        // person's cricket seasons and their football seasons are two stories.
        ...(sport === undefined ? [] : [eq(competitions.sport, sport)]),
      ),
    )
    .orderBy(asc(competitions.startsOn), asc(registrations.id))
    .limit(CAREER_PAGE_SIZE);

  const seasons: CareerSeason[] = rows.map((row) => ({
    registrationId: row.registrationId,
    competitionName: row.competitionName,
    competitionSlug: row.competitionSlug,
    sport: row.sport,
    tournamentName: row.tournamentName,
    orgName: row.orgName,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    auctionStatus: row.auctionStatus,
    role: row.role,
    status: row.status,
    teamName: row.teamName,
    teamColor: row.teamColor,
    isCaptain: row.isCaptain,
    isViceCaptain: row.isViceCaptain,
    jerseyNumber: row.jerseyNumber,
    auctionUnit: row.auctionUnit,
    // The sale first: a captain named after the night was bought, and that
    // is the fact their career records. Otherwise the pre-signed word.
    auction:
      row.lotStatus === "sold" && row.soldPrice !== null
        ? { kind: "sold", soldPrice: row.soldPrice }
        : isPreSigned(row)
          ? { kind: preSignedKind(row) ?? "icon" }
          : row.lotStatus === "unsold"
            ? { kind: "unsold" }
            : null,
  }));

  const soldPrices = (unit?: MoneyUnit) =>
    seasons
      .filter((season) => unit === undefined || season.auctionUnit === unit)
      .map((season) => (season.auction?.kind === "sold" ? season.auction.soldPrice : null))
      .filter((price): price is number => price !== null);
  const rupeeSales = soldPrices("inr");
  const highestUnit: MoneyUnit = rupeeSales.length > 0 ? "inr" : "points";
  const highestSales = rupeeSales.length > 0 ? rupeeSales : soldPrices("points");

  // P6: the same franchise across seasons is ONE team; unlinked teams fall
  // back to org·name, which is what a clone-by-name meant before franchises.
  const teamIdentities = new Set(
    rows
      .filter((row) => row.teamName !== null)
      .map((row) => row.teamFranchiseId ?? `${row.orgName}·${row.teamName ?? ""}`),
  );

  return {
    seasons,
    totals: {
      seasons: seasons.length,
      teams: teamIdentities.size,
      soldCount: soldPrices().length,
      highestPrice: highestSales.length > 0 ? Math.max(...highestSales) : null,
      highestUnit: highestSales.length > 0 ? highestUnit : "inr",
    },
  };
}

/**
 * The organizer's "seen before in your club" line (P5 screen map): the same
 * projection, scoped to ONE org — an organizer learns nothing about a person's
 * life in other clubs (doc 38: cross-org visibility needs the person's
 * consent; within the org, these are the club's own records).
 */
export async function personSeasonsInOrg(
  personId: string,
  orgId: string,
  excludeCompetitionId?: string,
): Promise<{ competitionName: string; startsOn: string | null; status: string }[]> {
  return systemDb
    .select({
      competitionName: competitions.name,
      startsOn: competitions.startsOn,
      status: registrations.status,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .where(
      and(
        eq(registrations.personId, personId),
        eq(registrations.orgId, orgId),
        // Excluded in SQL by id — two editions may share a name.
        ...(excludeCompetitionId !== undefined
          ? [ne(registrations.competitionId, excludeCompetitionId)]
          : []),
      ),
    )
    .orderBy(asc(competitions.startsOn))
    .limit(20);
}

/**
 * EVERY MATCH THIS PERSON'S TEAMS PLAYED, and whether they were on the field
 * (launch polish, Phase 3) — the half of "my profile" that results alone could
 * never answer, because results are recorded per team.
 *
 * `played` is three-valued on purpose, from the lineup record (0074):
 *   · "played"  — a lineup row for this registration;
 *   · "bench"   — the team's lineup was recorded and this person is not in it;
 *   · "unknown" — nobody recorded the team's lineup, so the page must not guess.
 *
 * Same posture as `playerCareer`: person-scoped from the session, system pool,
 * a projection over the fixture and result writers. Only matches that happened
 * (in progress or completed) — a scheduled fixture is not part of a career.
 */
export interface CareerMatch {
  fixtureId: string;
  /** The season this match belongs to, from this person's side. */
  registrationId: string;
  kickoffAt: string | null;
  sport: string;
  competitionName: string;
  teamName: string;
  opponentName: string;
  /** From this person's side: won, lost, tied, or no result; null while in progress. */
  result: "won" | "lost" | "tied" | "no_result" | null;
  played: "played" | "bench" | "unknown";
}

export const MATCHES_LIMIT = 100;

export async function playerMatches(personId: string): Promise<CareerMatch[]> {
  const home = alias(teams, "home_team");
  const away = alias(teams, "away_team");
  const rows = await systemDb
    .select({
      fixtureId: fixtures.id,
      kickoffAt: fixtures.kickoffAt,
      sport: competitions.sport,
      competitionName: competitions.name,
      registrationId: registrations.id,
      teamId: registrations.teamId,
      homeTeamId: fixtures.homeTeamId,
      homeName: home.name,
      awayName: away.name,
      outcome: fixtureResults.outcome,
      lineupRegistration: fixtureLineups.registrationId,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(
      fixtures,
      and(
        eq(fixtures.competitionId, registrations.competitionId),
        or(
          eq(fixtures.homeTeamId, registrations.teamId),
          eq(fixtures.awayTeamId, registrations.teamId),
        ),
      ),
    )
    .innerJoin(home, eq(home.id, fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, fixtures.awayTeamId))
    .leftJoin(fixtureResults, eq(fixtureResults.fixtureId, fixtures.id))
    .leftJoin(
      fixtureLineups,
      and(
        eq(fixtureLineups.fixtureId, fixtures.id),
        eq(fixtureLineups.registrationId, registrations.id),
      ),
    )
    .where(
      and(
        eq(registrations.personId, personId),
        isNotNull(registrations.teamId),
        inArray(fixtures.status, ["in_progress", "completed"]),
      ),
    )
    .orderBy(desc(fixtures.kickoffAt), desc(fixtures.seq))
    .limit(MATCHES_LIMIT);
  if (rows.length === 0) {
    return [];
  }
  // Which (fixture, team) pairs have ANY lineup — the difference between
  // "didn't play" and "nobody wrote it down".
  const recorded = await systemDb
    .selectDistinct({ fixtureId: fixtureLineups.fixtureId, teamId: fixtureLineups.teamId })
    .from(fixtureLineups)
    .where(inArray(fixtureLineups.fixtureId, [...new Set(rows.map((row) => row.fixtureId))]));
  const recordedPairs = new Set(recorded.map((row) => `${row.fixtureId}:${row.teamId}`));
  return rows.map((row) => {
    const isHome = row.homeTeamId === row.teamId;
    const result: CareerMatch["result"] =
      row.outcome === null
        ? null
        : row.outcome === "tie"
          ? "tied"
          : row.outcome === "no_result" || row.outcome === "abandoned"
            ? "no_result"
            : (row.outcome === "home_win") === isHome
              ? "won"
              : "lost";
    return {
      fixtureId: row.fixtureId,
      registrationId: row.registrationId,
      kickoffAt: row.kickoffAt,
      sport: row.sport,
      competitionName: row.competitionName,
      teamName: isHome ? row.homeName : row.awayName,
      opponentName: isHome ? row.awayName : row.homeName,
      result,
      played:
        row.lineupRegistration !== null
          ? "played"
          : recordedPairs.has(`${row.fixtureId}:${row.teamId ?? ""}`)
            ? "bench"
            : "unknown",
    };
  });
}

/**
 * WHAT IS NEXT ON THE CALENDAR — the published fixtures of the teams this
 * person is in, from now on. Same person-scoped system-pool class as
 * `playerMatches`; only PUBLISHED fixtures, because a draft or a merely
 * scheduled one is the organizer's working copy and not yet a promise.
 * `kickoffAt` is local wall-clock text, so "from now on" compares it as text
 * against today's date — lexicographic order IS chronological order there.
 */
export interface UpcomingMatch {
  fixtureId: string;
  kickoffAt: string | null;
  sport: string;
  competitionName: string;
  competitionSlug: string;
  /** The season this fixture belongs to, from this person's side. */
  registrationId: string;
  teamName: string;
  teamColor: string | null;
  opponentName: string;
  opponentColor: string | null;
  /** Where it is played, when the club named a ground. */
  groundName: string | null;
  /**
   * The organizer announced this player's place in the lineup, and they are
   * still in it. Only the announcement is the player's to know: a saved
   * lineup that was never announced (or a place taken away after it — the
   * founder's rule is that nobody is told that) says nothing.
   */
  announcedIn: boolean;
}

export const UPCOMING_LIMIT = 5;

export async function playerUpcomingMatches(
  personId: string,
  today: string,
): Promise<UpcomingMatch[]> {
  return playerOpenMatches(
    personId,
    and(
      eq(fixtures.status, "published"),
      or(isNull(fixtures.kickoffAt), gte(fixtures.kickoffAt, today)),
    ),
  );
}

/**
 * This person's matches whose day passed with no result — published and
 * never started, or started and left open (census 9: player home listed the
 * next match and the results, and the two owed in between vanished). Oldest
 * first; same subject rules as `playerUpcomingMatches`.
 */
export async function playerAwaitingMatches(
  personId: string,
  today: string,
): Promise<UpcomingMatch[]> {
  return playerOpenMatches(
    personId,
    and(
      inArray(fixtures.status, ["published", "in_progress"]),
      isNotNull(fixtures.kickoffAt),
      lt(fixtures.kickoffAt, `${today.slice(0, 10)}T00:00`),
    ),
  );
}

async function playerOpenMatches(
  personId: string,
  when: ReturnType<typeof and>,
): Promise<UpcomingMatch[]> {
  const home = alias(teams, "home_team");
  const away = alias(teams, "away_team");
  const rows = await systemDb
    .select({
      fixtureId: fixtures.id,
      kickoffAt: fixtures.kickoffAt,
      sport: competitions.sport,
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      registrationId: registrations.id,
      teamId: registrations.teamId,
      groundName: grounds.name,
      announcedIn: sql<boolean>`(
        exists (
          select 1 from ${fixtureLineups}
          where ${fixtureLineups.fixtureId} = ${fixtures.id}
            and ${fixtureLineups.registrationId} = ${registrations.id}
        )
        and exists (
          select 1 from ${messageOutbox}
          where ${messageOutbox.dedupeKey} = 'lineup.announced:' || ${fixtures.id} || ':' || ${registrations.id}
        )
      )`,
      homeTeamId: fixtures.homeTeamId,
      homeName: home.name,
      homeColor: home.primaryColor,
      awayName: away.name,
      awayColor: away.primaryColor,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(
      fixtures,
      and(
        eq(fixtures.competitionId, registrations.competitionId),
        or(
          eq(fixtures.homeTeamId, registrations.teamId),
          eq(fixtures.awayTeamId, registrations.teamId),
        ),
      ),
    )
    .innerJoin(home, eq(home.id, fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, fixtures.awayTeamId))
    .leftJoin(grounds, eq(grounds.id, fixtures.groundId))
    .where(and(eq(registrations.personId, personId), isNotNull(registrations.teamId), when))
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq))
    .limit(UPCOMING_LIMIT);
  return rows.map((row) => {
    const isHome = row.homeTeamId === row.teamId;
    return {
      fixtureId: row.fixtureId,
      kickoffAt: row.kickoffAt,
      sport: row.sport,
      competitionName: row.competitionName,
      competitionSlug: row.competitionSlug,
      registrationId: row.registrationId,
      teamName: isHome ? row.homeName : row.awayName,
      teamColor: isHome ? row.homeColor : row.awayColor,
      opponentName: isHome ? row.awayName : row.homeName,
      opponentColor: isHome ? row.awayColor : row.homeColor,
      groundName: row.groundName,
      announcedIn: row.announcedIn,
    };
  });
}

/*
 * A TEAM'S SEASON, for its owner's home (2026-09-28). After auction night the
 * owner home stopped moving — purse and top buys while the team was 2–0 with
 * a match that day. This is the season from the team's side: the next match,
 * the latest results, the record and the place in the table.
 *
 * The same class as the reads above — the system pool, scoped by a subject the
 * SERVER resolved. `teamId` must come from `rolesOf(session)` (the owner's own
 * teams), never from a request. Only fixtures the public can see (published,
 * live, completed), so a draft schedule never shows as fixed.
 */
export interface TeamSeasonMatch {
  fixtureId: string;
  kickoffAt: string | null;
  opponentName: string;
  opponentColor: string | null;
  groundName: string | null;
  /** Being played right now. */
  live: boolean;
  /** From this team's side; null while it is being played or still to come. */
  result: "won" | "lost" | "tied" | "no_result" | null;
}

export interface TeamSeason {
  /** Published matches still to come (or live today), kickoff order. */
  upcoming: TeamSeasonMatch[];
  /**
   * Matches whose day has passed with no result — never started, or started
   * and left open. They used to fall between "upcoming" (kickoff before
   * today) and "results" (no result) and vanish: an owner read "1 to come"
   * with three matches unaccounted for. Kickoff order.
   */
  awaiting: TeamSeasonMatch[];
  /** Results, newest first. */
  results: TeamSeasonMatch[];
  record: { played: number; won: number; lost: number; tied: number };
  /** Place in the table — null for a lobby-shaped sport or before any team plays. */
  place: { position: number; of: number; points: number } | null;
}

export async function teamSeason(teamId: string, today: string): Promise<TeamSeason | null> {
  const [team] = await systemDb
    .select({ competitionId: teams.competitionId, sport: competitions.sport })
    .from(teams)
    .innerJoin(competitions, eq(competitions.id, teams.competitionId))
    .where(eq(teams.id, teamId))
    .limit(1);
  if (team === undefined) return null;
  const home = alias(teams, "home_team");
  const away = alias(teams, "away_team");
  const rows = await systemDb
    .select({
      fixtureId: fixtures.id,
      kickoffAt: fixtures.kickoffAt,
      status: fixtures.status,
      homeTeamId: fixtures.homeTeamId,
      homeName: home.name,
      homeColor: home.primaryColor,
      awayName: away.name,
      awayColor: away.primaryColor,
      groundName: grounds.name,
      outcome: fixtureResults.outcome,
    })
    .from(fixtures)
    .innerJoin(home, eq(home.id, fixtures.homeTeamId))
    .innerJoin(away, eq(away.id, fixtures.awayTeamId))
    .leftJoin(grounds, eq(grounds.id, fixtures.groundId))
    .leftJoin(fixtureResults, eq(fixtureResults.fixtureId, fixtures.id))
    .where(
      and(
        eq(fixtures.competitionId, team.competitionId),
        or(eq(fixtures.homeTeamId, teamId), eq(fixtures.awayTeamId, teamId)),
        inArray(fixtures.status, ["published", "in_progress", "completed"]),
      ),
    )
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq))
    .limit(MATCHES_LIMIT);
  const matches = rows.map((row) => {
    const isHome = row.homeTeamId === teamId;
    const result: TeamSeasonMatch["result"] =
      row.outcome === null
        ? null
        : row.outcome === "tie"
          ? "tied"
          : row.outcome === "no_result" || row.outcome === "abandoned"
            ? "no_result"
            : (row.outcome === "home_win") === isHome
              ? "won"
              : "lost";
    return {
      status: row.status,
      match: {
        fixtureId: row.fixtureId,
        kickoffAt: row.kickoffAt,
        opponentName: isHome ? row.awayName : row.homeName,
        opponentColor: isHome ? row.awayColor : row.homeColor,
        groundName: row.groundName,
        live: row.status === "in_progress",
        result,
      },
    };
  });
  // A match on a day before today with no result is awaiting one, whether it
  // was never started or started and left open — not "next", and not "live".
  const pastDay = (kickoffAt: string | null) =>
    kickoffAt !== null && kickoffAt.slice(0, 10) < today.slice(0, 10);
  const open = matches.filter(({ status }) => status === "in_progress" || status === "published");
  const awaiting = open
    .filter(({ match }) => pastDay(match.kickoffAt))
    .map(({ match }) => ({ ...match, live: false }));
  const upcoming = open.filter(({ match }) => !pastDay(match.kickoffAt)).map(({ match }) => match);
  const results = matches
    .filter(({ status, match }) => status === "completed" && match.result !== null)
    .map(({ match }) => match)
    .reverse();
  const record = { played: results.length, won: 0, lost: 0, tied: 0 };
  for (const match of results) {
    if (match.result === "won") record.won += 1;
    else if (match.result === "lost") record.lost += 1;
    else if (match.result === "tied") record.tied += 1;
  }
  let place: TeamSeason["place"] = null;
  if (sportPackFor(team.sport).fixtureShape !== "lobby") {
    const standings = await standingsOf(systemDb, team.competitionId);
    const index = standings.rows.findIndex((row) => row.teamId === teamId);
    const row = standings.rows[index];
    if (row !== undefined && standings.rows.some((entry) => entry.played > 0)) {
      place = { position: index + 1, of: standings.rows.length, points: row.points };
    }
  }
  return { upcoming, awaiting, results, record, place };
}
