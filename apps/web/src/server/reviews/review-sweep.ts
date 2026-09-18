import { sql } from "drizzle-orm";

import { db, systemDb } from "../db";
import { maySend } from "../messaging/consent";
import { transactionalMailer } from "../messaging/transactional-mail";
import { reviewAskMail, type AskAudience } from "./review-mail";
import { askForPlatformReview, isKnownMinor, markAskSent } from "./reviews";
import { askSeason, seasonRef } from "./season";

/**
 * ASKING WITHOUT BEING TOLD TO (FR-1 Phase 3).
 *
 * Two moments earn an ask, and both are READ FROM WHAT HAPPENED, never from a
 * flag somebody set:
 *
 *   · AN AUCTION CLOSED. The time is the `AuctionClosed` event in the auction's
 *     own ledger — `auctions.status` says "completed" but not when, and 96 local
 *     auctions are "completed" with no close event at all (seeded rows). A row
 *     nobody closed is not a night anybody lived through.
 *   · A SEASON FINISHED. There is no season status that says so, so it is
 *     derived: every fixture completed or cancelled, at least one actually
 *     played, finished at the latest fixture's own timestamp.
 *
 * WHO. For an auction: the club's organizers (an active `org:owner` or
 * `org:staff` grant — NOT org membership, because team owners are viewer-level
 * members too) and everyone who held a paddle. For a season: the organizers.
 * One platform ask per person, ever (0065's unique index); somebody already
 * asked, by hand or by an earlier sweep, is left alone.
 *
 * WHEN. No sooner than two hours after the moment — the room is still packing
 * up, and the settlement desk is what an organizer should be looking at — and
 * no later than fourteen days. The upper bound is what stops the first run
 * after this ships from mailing everybody who ever ran an auction here.
 *
 * WHO NOT. No email, no ask (there is nobody at the desk to hand a link to). A
 * known minor, never. Somebody who switched "Feedback requests" off still gets
 * the ask RECORDED — so no later sweep reconsiders them — and is never mailed.
 *
 * The candidate read crosses every tenant, so it runs on the SYSTEM pool; the
 * asks are written on the app pool, where review_requests lives unguarded.
 */

export const ASK_DELAY_MS = 2 * 60 * 60 * 1000;
export const ASK_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
/** Per run. A burst beyond this waits for the next run rather than one mail storm. */
export const ASK_BATCH_LIMIT = 200;

export interface AskCandidate {
  readonly personId: string;
  readonly name: string | null;
  readonly email: string;
  readonly dateOfBirth: string | null;
  readonly source: "auction_completed" | "season_completed";
  readonly audience: Exclude<AskAudience, "general">;
}

/**
 * Everyone owed an ask right now. Hand-written SQL with explicit aliases —
 * drizzle's raw-SQL column interpolation emits unqualified names that bind to
 * the wrong table inside subqueries (see the PX-9 admin views).
 */
export async function autoAskCandidates(
  now: Date = new Date(),
  limit: number = ASK_BATCH_LIMIT,
): Promise<readonly AskCandidate[]> {
  const until = new Date(now.getTime() - ASK_DELAY_MS).toISOString();
  const from = new Date(now.getTime() - ASK_LOOKBACK_MS).toISOString();
  const rows = await systemDb.execute<{
    person_id: string;
    name: string | null;
    email: string;
    date_of_birth: string | null;
    source: "auction_completed" | "season_completed";
    audience: "organizer" | "owner";
  }>(sql`
    with closed as (
      select a.id as auction_id, a.org_id, min(e.created_at) as at
      from auctions a
      join auction_events e on e.auction_id = a.id and e.type = 'AuctionClosed'
      where a.status in ('completed', 'reconciled')
      group by a.id, a.org_id
      having min(e.created_at) between ${from}::timestamptz and ${until}::timestamptz
    ),
    finished as (
      select c.id as competition_id, c.org_id,
        max(coalesce(f.completed_at, f.cancelled_at)) as at
      from competitions c
      join fixtures f on f.competition_id = c.id
      group by c.id, c.org_id
      having bool_and(f.status in ('completed', 'cancelled'))
        and bool_or(f.status = 'completed')
        and max(coalesce(f.completed_at, f.cancelled_at))
          between ${from}::timestamptz and ${until}::timestamptz
    ),
    recipients as (
      select g.person_id, 'auction_completed' as source, 'organizer' as audience, cl.at
      from closed cl
      join grants g on g.scope_type = 'org' and g.scope_id = cl.org_id
        and g.capability_set in ('org:owner', 'org:staff') and g.revoked_at is null
      union all
      select pd.person_id, 'auction_completed', 'owner', cl.at
      from closed cl
      join paddles pd on pd.auction_id = cl.auction_id
      union all
      select g.person_id, 'season_completed', 'organizer', fi.at
      from finished fi
      join grants g on g.scope_type = 'org' and g.scope_id = fi.org_id
        and g.capability_set in ('org:owner', 'org:staff') and g.revoked_at is null
    ),
    chosen as (
      -- One row per person: an organizer reading is preferred over an owner
      -- one (they ran it), then the earliest moment.
      select distinct on (r.person_id) r.person_id, r.source, r.audience, r.at
      from recipients r
      order by r.person_id, (r.audience = 'organizer') desc, r.at asc
    )
    select ch.person_id, pe.name, pe.email, ch.source, ch.audience,
      coalesce(
        pp.date_of_birth,
        (select rg.date_of_birth from registrations rg
          where rg.person_id = pe.id and rg.date_of_birth is not null
          order by rg.created_at desc limit 1)
      ) as date_of_birth
    from chosen ch
    join people pe on pe.id = ch.person_id
    left join player_profiles pp on pp.person_id = pe.id
    where pe.email is not null
      and not exists (
        select 1 from review_requests rr
        where rr.person_id = ch.person_id and rr.subject_type = 'platform'
      )
    order by ch.at asc
    limit ${limit}
  `);
  return rows.map((row) => ({
    personId: row.person_id.trim(),
    name: row.name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    source: row.source,
    audience: row.audience,
  }));
}

/**
 * Seasons owed a tournament ask right now (Phase 4), with who is owed it:
 * an auction that closed owes its OWNERS; a season that finished owes its
 * players AND owners. Same window, same ledger-derived moments as above.
 */
export async function seasonsOwedAsks(now: Date = new Date()): Promise<
  readonly {
    competitionId: string;
    roles: ("player" | "owner")[];
    source: "auction_completed" | "season_completed";
  }[]
> {
  const until = new Date(now.getTime() - ASK_DELAY_MS).toISOString();
  const from = new Date(now.getTime() - ASK_LOOKBACK_MS).toISOString();
  const rows = await systemDb.execute<{
    competition_id: string;
    source: "auction_completed" | "season_completed";
  }>(sql`
    select a.competition_id, 'auction_completed' as source
    from auctions a
    join auction_events e on e.auction_id = a.id and e.type = 'AuctionClosed'
    where a.status in ('completed', 'reconciled')
    group by a.competition_id
    having min(e.created_at) between ${from}::timestamptz and ${until}::timestamptz
    union all
    select f.competition_id, 'season_completed'
    from fixtures f
    group by f.competition_id
    having bool_and(f.status in ('completed', 'cancelled'))
      and bool_or(f.status = 'completed')
      and max(coalesce(f.completed_at, f.cancelled_at))
        between ${from}::timestamptz and ${until}::timestamptz
  `);
  return rows.map((row) => ({
    competitionId: row.competition_id.trim(),
    source: row.source,
    roles: row.source === "season_completed" ? ["player", "owner"] : ["owner"],
  }));
}

export interface SweepResult {
  readonly considered: number;
  readonly asked: number;
  readonly mailed: number;
  readonly optedOut: number;
  readonly minors: number;
  readonly mailFailed: number;
  /** Phase 4: tournament asks, sharing the same per-run budget. */
  readonly seasonAsked: number;
  readonly seasonMailed: number;
}

export async function sweepReviewAsks(now: Date = new Date()): Promise<SweepResult> {
  const candidates = await autoAskCandidates(now);
  let asked = 0;
  let mailed = 0;
  let optedOut = 0;
  let minors = 0;
  let mailFailed = 0;
  const mailer = transactionalMailer();

  for (const candidate of candidates) {
    if (isKnownMinor(candidate, now)) {
      minors += 1;
      continue;
    }
    const ask = await askForPlatformReview(db, {
      personId: candidate.personId,
      source: candidate.source,
      requestedBy: null,
      now,
      reissue: false,
    });
    // Somebody asked them between the read and now (a desk press, or a second
    // sweep running at once). The unique index decided; we step aside.
    if (!ask.created) {
      continue;
    }
    asked += 1;
    const decision = await maySend(db, {
      contact: candidate.email,
      channel: "email",
      category: "transactional",
      scope: "feedback",
      personId: candidate.personId,
      now,
    });
    if (!decision.send) {
      optedOut += 1;
      continue;
    }
    const outcome = await mailer.send({
      to: candidate.email,
      ...reviewAskMail(candidate.name, ask.link, candidate.audience),
    });
    if (outcome === "sent") {
      await markAskSent(db, ask.requestId, candidate.email, now);
      mailed += 1;
    } else {
      mailFailed += 1;
    }
  }

  // Tournament asks spend whatever the platform asks left of the budget.
  let seasonAsked = 0;
  let seasonMailed = 0;
  for (const owed of await seasonsOwedAsks(now)) {
    const remaining = ASK_BATCH_LIMIT - asked - seasonAsked;
    if (remaining <= 0) {
      break;
    }
    const season = await seasonRef(owed.competitionId);
    if (season === null) {
      continue;
    }
    const result = await askSeason(season, {
      roles: owed.roles,
      source: owed.source,
      requestedBy: null,
      now,
      budget: remaining,
    });
    seasonAsked += result.asked;
    seasonMailed += result.mailed;
    optedOut += result.optedOut;
    mailFailed += result.mailFailed;
  }

  return {
    considered: candidates.length,
    asked,
    mailed,
    optedOut,
    minors,
    mailFailed,
    seasonAsked,
    seasonMailed,
  };
}
