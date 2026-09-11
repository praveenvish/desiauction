import {
  deriveAge,
  isBattingStyle,
  isBowlingStyle,
  isRoleIn,
  nameKey,
  normalizeShareSource,
  registrationNumber,
  registrationTransition,
  toCsv,
  type FeeStatus,
  type PhotoTarget,
  sportPackFor,
  type RegistrationStatus,
} from "@desiauction/core";
import {
  auditLog,
  competitions,
  newId,
  people,
  registrations,
  teams,
  writeSurvivingConstraint,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { storage } from "../media";

// Registration reads + creation (IP-3 §4, doc 42). TRIAGE TRANSITIONS live only
// in registration-aggregate.ts; this module owns ENTRY into the competition —
// creating the row, and the one case where entry lands on a row that already
// exists (`reinstateWithdrawn`, below). The dashboard queries here are
// server-driven (search/filter/sort/pagination in SQL) so the client never loads
// the whole dataset (M-IP3-2 performance target).

/**
 * A pool handle or an open transaction. Entry runs on both: the self-service
 * and single-player paths hold a pool, the CSV import commits every row inside
 * ONE transaction and must reinstate through the same helper rather than
 * growing a second copy of the rule.
 */
type Writer = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type SubmitResult =
  | { ok: true; registrationId: string }
  | { ok: false; reason: "invalid_role" | "not_open" | "duplicate" | "no_phone" };

/** Optional self-declared player profile captured at registration (parity §3.2).
 * Each field is validated here; invalid values are dropped, never persisted. */
export interface PlayerProfileInput {
  dateOfBirth?: string;
  battingStyle?: string;
  bowlingStyle?: string;
}

function validProfile(profile: PlayerProfileInput | undefined): Partial<{
  dateOfBirth: string;
  battingStyle: string;
  bowlingStyle: string;
}> {
  if (profile === undefined) {
    return {};
  }
  const out: { dateOfBirth?: string; battingStyle?: string; bowlingStyle?: string } = {};
  if (profile.dateOfBirth !== undefined && deriveAge(profile.dateOfBirth, new Date()) !== null) {
    out.dateOfBirth = profile.dateOfBirth;
  }
  if (profile.battingStyle !== undefined && isBattingStyle(profile.battingStyle)) {
    out.battingStyle = profile.battingStyle;
  }
  if (profile.bowlingStyle !== undefined && isBowlingStyle(profile.bowlingStyle)) {
    out.bowlingStyle = profile.bowlingStyle;
  }
  return out;
}

/**
 * A WITHDRAWAL IS NOT A LIFE SENTENCE.
 *
 * `registrations_competition_person_uq` is a TOTAL unique index on (competition,
 * person), so the second row a returning player needs cannot exist — and every
 * entry path read that refusal as `duplicate`. A player who tapped Withdraw by
 * mistake was then locked out of that season permanently, with the only exit
 * being an organizer noticing and running an explicit `restore`.
 *
 * The fix is the dormant row, not a second one. Core's machine already names
 * exactly one exit from `withdrawn` — `restore` → `submitted` — so a
 * re-registration IS that edge, taken by the player instead of the organizer.
 * The alternative (a partial index exempting withdrawn rows) would let one
 * person hold several registrations in one season, which `myRegistration` and
 * `registrationStats` both assume cannot happen; it would also scatter the
 * player's history across rows, when `timelineOf` keys on the registration id.
 *
 * Returns null when there is nothing to reinstate — no row, or a row in any
 * LIVE state. A live registration still refuses a second one: that refusal is
 * the duplicate rule doing its job, and a rejected registration is the
 * organizer's decision, which re-applying must never quietly overturn.
 */
export async function reinstateWithdrawn(
  db: Writer,
  competitionId: string,
  personId: string,
  fresh: {
    /** The season's pack key — not cricket's four (migration 0047 opened it). */
    role: string;
    // Both callers always pass these, absent or not, so `| undefined` rather
    // than optional (exactOptionalPropertyTypes).
    basePriceBand: string | null | undefined;
    profile: PlayerProfileInput | undefined;
  },
): Promise<{ id: string; number: string } | null> {
  const [existing] = await db
    .select({ id: registrations.id, status: registrations.status })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), eq(registrations.personId, personId)),
    )
    .limit(1);
  if (existing === undefined || existing.status !== "withdrawn") {
    return null;
  }
  // The machine decides, here as everywhere: if `withdrawn --restore-->` is ever
  // removed from core, this stops reinstating rather than inventing an edge.
  const decision = registrationTransition(existing.status, { type: "restore" });
  if (!decision.ok) {
    return null;
  }
  const [updated] = await db
    .update(registrations)
    .set({
      status: decision.next,
      role: fresh.role,
      ...(fresh.basePriceBand !== undefined &&
      fresh.basePriceBand !== null &&
      fresh.basePriceBand !== ""
        ? { basePriceBand: fresh.basePriceBand }
        : {}),
      ...validProfile(fresh.profile),
      // Back in triage, unreviewed: stale rejection provenance and a stale
      // reviewer would both describe a decision about a different application.
      rejectionReason: null,
      rejectionNote: null,
      reviewedBy: null,
      reviewedAt: null,
    })
    // Re-asserting `withdrawn` in the WHERE makes this a compare-and-set: an
    // organizer restoring the same row between the read and the write wins, and
    // this call reports the duplicate it now truly is.
    .where(and(eq(registrations.id, existing.id), eq(registrations.status, "withdrawn")))
    .returning({ id: registrations.id, number: registrations.registrationNumber });
  return updated ?? null;
}

/**
 * A Person applies to a Competition. Any authenticated person may register while
 * intake is open (they need not be an org member — they are a player, doc 42).
 * Duplicate = same person in the same competition (unique index, invariant) —
 * unless the row on the other side of that index was WITHDRAWN, in which case
 * this is a rejoin and it reinstates.
 */
export async function submitRegistration(
  db: Db,
  competitionId: string,
  orgId: string,
  personId: string,
  role: string,
  basePriceBand?: string,
  profile?: PlayerProfileInput,
  /** Raw `?ref` share source (bounded to an allowlist before it is persisted). */
  source?: string,
): Promise<SubmitResult> {
  /*
   * THE SEASON DECIDES WHAT A ROLE IS, so the season has to be read first.
   *
   * This checked `isRegistrationRole`, which asks CRICKET — the same
   * cricket-only question the eligibility evaluator was asking one layer up, so
   * a football role was refused twice over and no player could enter a season
   * of any sport but one. The defense-in-depth is right; it was just asking
   * about the wrong sport.
   */
  const [competition] = await db
    .select({ status: competitions.status, sport: competitions.sport })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (competition === undefined || competition.status !== "registration_open") {
    return { ok: false, reason: "not_open" };
  }
  /*
   * A PLAYER NEEDS A PHONE, and this is the server-side half of saying so.
   *
   * Email sign-in (0062) lets somebody hold an account with no number. That is
   * fine for an organizer, a team owner or a treasurer — every one of those
   * roles is worked through this website. A PLAYER is different: the whole
   * back half of the product reaches them by SMS and by nothing else. The
   * approval and rejection notices, the auction-day summons, the sold message,
   * the roster export the organizer rings down — all of it is `people.phone`,
   * and `registrationsForNotify` suppresses a null rather than failing, so an
   * email-only player would be entered, approved, auctioned and never told.
   *
   * Refused rather than quietly entered, and refused HERE rather than only in
   * the form, because the form is a suggestion and this is the rule. The
   * account page's attach flow is the way through, and the screen says so.
   */
  const [applicant] = await db
    .select({ phone: people.phone })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (applicant === undefined || applicant.phone === null) {
    return { ok: false, reason: "no_phone" };
  }
  const pack = sportPackFor(competition.sport);
  // Empty and wrong are different answers — see `evaluateRegistration`.
  if (role.trim() === "" ? pack.roles.required : !isRoleIn(pack, role)) {
    return { ok: false, reason: "invalid_role" };
  }
  const id = newId();
  // Unique (competition_id, person_id) — one registration per player per season.
  const inserted = await writeSurvivingConstraint(db, (tx) =>
    tx.insert(registrations).values({
      id,
      orgId,
      competitionId,
      personId,
      role,
      status: "submitted",
      registrationNumber: registrationNumber(id),
      ...(basePriceBand !== undefined && basePriceBand !== "" ? { basePriceBand } : {}),
      ...validProfile(profile),
    }),
  );
  // Insert first, ask questions second: the ordinary case stays one statement,
  // and the extra reads happen only on the collision. writeSurvivingConstraint
  // rolls the failed insert back to its savepoint, so the surrounding tenant
  // transaction is still alive for the reinstatement below.
  let registrationId = id;
  if (!inserted) {
    const reinstated = await reinstateWithdrawn(db, competitionId, personId, {
      role,
      basePriceBand,
      profile,
    });
    if (reinstated === null) {
      return { ok: false, reason: "duplicate" };
    }
    registrationId = reinstated.id;
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "registration.submitted",
    scopeType: "org",
    scopeId: orgId,
    subject: registrationId,
    meta: {
      competitionId,
      role,
      source: normalizeShareSource(source),
      // The timeline should read apply → withdraw → rejoin, not two identical
      // applications with an unexplained withdrawal between them.
      ...(inserted ? {} : { reinstated: "true" }),
    },
  });
  return { ok: true, registrationId };
}

export type AddPlayerResult =
  | { ok: true; registrationId: string; number: string; personId: string; personExisted: boolean }
  | { ok: false; reason: "duplicate" };

/**
 * An organizer enters a player who did not sign up themselves (parity §3.3).
 * Identity is still the phone (C-24): an existing person is reused, an unknown
 * one becomes an unverified STUB — exactly what the CSV import creates, because
 * this is the same act performed one row at a time. The player lands in
 * `submitted` and passes the same human approval gate (invariant 5); status is
 * only ever moved afterwards by the aggregate, never written here.
 *
 * A player who previously withdrew is REINSTATED rather than refused, exactly as
 * on the self-service path (see `reinstateWithdrawn`); the returned number is
 * then their original one.
 *
 * DA-35 — DELIBERATE: unlike `submitRegistration`, this does NOT refuse when
 * intake is closed, and that asymmetry is the point. Closure closes the PUBLIC
 * door: it stops strangers arriving from a shared link. An organizer entering a
 * player they already agreed to take is not a stranger arriving — it is the
 * organizer exercising the same authority that closed the door. Requiring them
 * to reopen public registration to add one late signing would open the season
 * to everyone with the link. The Registrations tab says so at the point of use.
 */
export async function addPlayerByPhone(
  db: Db,
  competitionId: string,
  orgId: string,
  actorId: string,
  player: {
    name: string;
    phone: string;
    /** The season's pack key — not cricket's four (migration 0047 opened it). */
    role: string;
    basePriceBand: string | null;
    profile?: PlayerProfileInput;
  },
): Promise<AddPlayerResult> {
  const [found] = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.phone, player.phone))
    .limit(1);
  let personId = found?.id;
  const personExisted = personId !== undefined;
  if (personId === undefined) {
    const fresh = newId();
    // onConflictDoNothing, not try/catch: a raised unique violation would abort
    // the surrounding tenant transaction (the savepoint trap).
    const inserted = await db
      .insert(people)
      .values({ id: fresh, phone: player.phone, name: player.name })
      .onConflictDoNothing({ target: people.phone })
      .returning({ id: people.id });
    personId =
      inserted[0]?.id ??
      (
        await db
          .select({ id: people.id })
          .from(people)
          .where(eq(people.phone, player.phone))
          .limit(1)
      )[0]?.id;
    if (personId === undefined) {
      return { ok: false, reason: "duplicate" };
    }
  } else if (found?.name === null) {
    // A stub someone else created has no name yet; the organizer just supplied
    // one. An existing name is never overwritten — it is not ours to correct.
    await db.update(people).set({ name: player.name }).where(eq(people.id, personId));
  }

  const id = newId();
  const created = await writeSurvivingConstraint(db, (tx) =>
    tx.insert(registrations).values({
      id,
      orgId,
      competitionId,
      personId,
      role: player.role,
      status: "submitted",
      registrationNumber: registrationNumber(id),
      ...(player.basePriceBand !== null ? { basePriceBand: player.basePriceBand } : {}),
      ...validProfile(player.profile),
    }),
  );
  // A player the organizer is deliberately entering, who withdrew earlier, is a
  // rejoin here too — the dead end is the same one whichever door you came in
  // through, and the organizer's own act is the least ambiguous version of it.
  let registrationId = id;
  let number = registrationNumber(id);
  if (!created) {
    const reinstated = await reinstateWithdrawn(db, competitionId, personId, {
      role: player.role,
      basePriceBand: player.basePriceBand,
      profile: player.profile,
    });
    if (reinstated === null) {
      return { ok: false, reason: "duplicate" };
    }
    registrationId = reinstated.id;
    number = reinstated.number;
  }
  // Subject = the registration, so the player's timeline begins where they
  // entered the competition (the DA-27 lesson from the import path).
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "registration.added",
    scopeType: "org",
    scopeId: orgId,
    subject: registrationId,
    meta: {
      competitionId,
      role: player.role,
      source: "organizer_manual",
      ...(created ? {} : { reinstated: "true" }),
    },
  });
  return { ok: true, registrationId, number, personId, personExisted };
}

export interface RegistrationRow {
  id: string;
  number: string;
  personId: string;
  name: string | null;
  /**
   * NULLABLE SINCE 0062 for the rows that predate the rule, never for a new
   * one: `submitRegistration` refuses an account with no number, because SMS
   * is the only channel a season reaches a player on.
   */
  phone: string | null;
  role: string | null;
  status: RegistrationStatus;
  teamId: string | null;
  teamName: string | null;
  // Icon (marquee) player: pre-assigned to their team, excluded from the auction.
  isIcon: boolean;
  // Retained from a prior season: pre-assigned and excluded the same way. The
  // row carried every other mark and not this one, so the dashboard could not
  // show the flag it now lets an organizer set.
  isRetained: boolean;
  // Team captain marker (display + team-sheet ordering).
  isCaptain: boolean;
  /**
   * THE REGISTRATION DESK (0034), which was write-only until now.
   *
   * All four have been importable, validated and stored since the desk columns
   * landed — and rendered on no screen and in no export. A club takes cash at
   * the ground, records it in their sheet, imports it, and then could not
   * answer "who has paid?" from this product at all. They went back to the
   * spreadsheet, which is the thing the import exists to replace.
   */
  feeStatus: FeeStatus;
  /** Integer paise. Null = no amount recorded, which is not zero. */
  feeAmountPaise: number | null;
  feeReference: string | null;
  /** The organizer's own remark — distinct from a rejection's note. */
  note: string | null;
  /**
   * THE KIT BLOCK (0034), and it was write-only for exactly as long as the fee
   * was. The schema comment says what it is for — "only organizers who order
   * jerseys populate it" — so a club imports two hundred names, numbers and
   * sizes precisely to place an order, and the product could not give the list
   * back. They reopened the spreadsheet, which is the thing the import exists
   * to replace.
   *
   * `fatherName` rides here rather than in a "kit" object because it is not
   * kit: Indian registration forms ask for it as an identity check, and it
   * belongs beside the player's own name on the record.
   */
  jerseyName: string | null;
  jerseyNumber: string | null;
  tshirtSize: string | null;
  trouserSize: string | null;
  fatherName: string | null;
  // Surfaced for the IP-4 AuctionReady pool (additive projection field, M-IP4-1).
  basePriceBand: string | null;
  rejectionReason: string | null;
  /**
   * WHAT "OTHER" MEANT — the organizer's own words, and organizer-only.
   *
   * Invariant 6: the player is told a respectful sentence derived from the
   * CATEGORY, never this. It is absent from `myRegistration` on purpose, and a
   * regression test holds it absent.
   */
  rejectionNote: string | null;
  duplicateName: boolean;
  // Parity §3.2 profile. photoUrl is DPDP-gated: null unless photo_consent_at is
  // set (render gate, DPDP §5). age is derived from DOB, never stored.
  photoUrl: string | null;
  age: number | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
}

/** Legacy triage list for the M-IP3-1 competition page (latest first, unpaged). */
export async function registrationsOf(db: Db, competitionId: string): Promise<RegistrationRow[]> {
  const query: RegistrationQuery = { page: 1, pageSize: 100, sort: "recent" };
  const { rows } = await queryRegistrations(db, competitionId, query);
  return rows;
}

/** A person's own registration in a competition (their status page seed, doc 42). */
export async function myRegistration(
  db: Db,
  competitionId: string,
  personId: string,
): Promise<{
  id: string;
  status: RegistrationStatus;
  role: string | null;
  number: string;
  /**
   * DA-35: the reason was captured, shipped to the organizer's browser and
   * rendered nowhere — least of all to the person it was about, who was told
   * to "reach the organizer through whoever shared the link". It is theirs.
   */
  rejectionReason: string | null;
} | null> {
  const [row] = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      role: registrations.role,
      number: registrations.registrationNumber,
      rejectionReason: registrations.rejectionReason,
    })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), eq(registrations.personId, personId)),
    )
    .limit(1);
  return row ?? null;
}

// --- Dashboard: statistics, search/filter/sort/pagination (M-IP3-2) ----------

export interface RegistrationStats {
  total: number;
  submitted: number;
  approved: number;
  rejected: number;
  waitlisted: number;
  withdrawn: number;
  /**
   * DA-35: what auction night will actually contain. Two tabs of one console
   * disagreed — Registrations said "Approved 2" while the Auction tab's
   * readiness gate said "1 approved player(s)" — because an Icon is approved
   * AND excluded from the block. This figure is computed from the same facts
   * the auction filters on, so the two screens can no longer drift apart.
   *
   * THE SAME DRIFT CAME BACK THROUGH THE SECOND PRE-SIGNED MARK. This counted
   * `isIcon` only, exactly as `auction-ready.ts` did, so both were wrong in the
   * same direction and agreed with each other while disagreeing with the
   * poster, the showcase and the career page. Both now read both marks.
   */
  auctionPool: number;
  /** Approved icons — pre-signed, never on the block. */
  icons: number;
  /** Approved retained players — pre-signed from a prior season, never on the block. */
  retained: number;
  /**
   * Approved icons with no team. An icon is only counted into a squad when
   * `registrations.team_id = paddle.team_id`, so a teamless icon is in NO
   * auction and NO squad — a player the product has quietly disappeared. The
   * screen warns; the aggregate constraint itself is not ours to change.
   */
  iconsWithoutTeam: number;
  /** The same disappearance, reached by the other mark. */
  retainedWithoutTeam: number;
  /**
   * THE DESK'S OWN ARITHMETIC, over every registration that is not withdrawn.
   *
   * Counted across all live statuses rather than approved only: a club takes
   * the entry fee when somebody signs up, long before triage decides anything,
   * so "who has paid?" and "who is approved?" are different questions and
   * answering the first with the second's rows would under-report the money.
   *
   * A withdrawn registration is excluded — they left, and a fee they paid is a
   * refund question, not an outstanding one.
   */
  fees: { pending: number; paid: number; waived: number; refunded: number };
  /**
   * Paise actually collected — the sum of `fee_amount_paise` over rows marked
   * paid. Null amounts contribute nothing, because "no amount recorded" is not
   * zero and a desk that logged a payment without its size should not have that
   * read back as free.
   */
  feeCollectedPaise: number;
}

export async function registrationStats(db: Db, competitionId: string): Promise<RegistrationStats> {
  const rows = await db
    .select({
      status: registrations.status,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
      hasTeam: sql<boolean>`${registrations.teamId} is not null`,
      feeStatus: registrations.feeStatus,
      /*
       * Summed inside the group so a null amount contributes nothing rather
       * than turning the whole total null, which `sum()` would do.
       *
       * `::double precision` is the idiom every other money sum here uses, and
       * it is exact for this: paise are integers, and a double holds those
       * without loss to 2^53 — about ninety trillion rupees. C-7's ban on
       * floats is about ARITHMETIC on money, which this is not; it is a
       * read-only total for a tile.
       */
      feePaise: sql<number>`coalesce(sum(${registrations.feeAmountPaise}), 0)::double precision`,
      count: sql<number>`count(*)::int`,
    })
    .from(registrations)
    .where(eq(registrations.competitionId, competitionId))
    .groupBy(
      registrations.status,
      registrations.isIcon,
      registrations.isRetained,
      registrations.feeStatus,
      sql`${registrations.teamId} is not null`,
    );
  const stats: RegistrationStats = {
    total: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
    waitlisted: 0,
    withdrawn: 0,
    auctionPool: 0,
    icons: 0,
    retained: 0,
    iconsWithoutTeam: 0,
    retainedWithoutTeam: 0,
    fees: { pending: 0, paid: 0, waived: 0, refunded: 0 },
    feeCollectedPaise: 0,
  };
  for (const row of rows) {
    // Registrations are created in "submitted"; "draft" is a machine-only state
    // that is never persisted here, so it is not a counted bucket.
    if (row.status !== "draft") {
      stats[row.status] += row.count;
    }
    stats.total += row.count;
    // The desk counts everyone still in the season, whatever triage has decided
    // about them — see `fees`.
    if (row.status !== "withdrawn" && row.status !== "draft") {
      stats.fees[row.feeStatus] += row.count;
      if (row.feeStatus === "paid") {
        stats.feeCollectedPaise += row.feePaise;
      }
    }
    if (row.status === "approved") {
      // Icon first where a player is both, the precedence `outcomeOf` and the
      // orphan warning already use — one row must not be counted twice, and
      // `auctionPool` is the figure that has to match the auction exactly.
      if (row.isIcon) {
        stats.icons += row.count;
        if (!row.hasTeam) {
          stats.iconsWithoutTeam += row.count;
        }
      } else if (row.isRetained) {
        stats.retained += row.count;
        if (!row.hasTeam) {
          stats.retainedWithoutTeam += row.count;
        }
      } else {
        stats.auctionPool += row.count;
      }
    }
  }
  return stats;
}

export type RegistrationSort = "recent" | "oldest" | "name" | "number" | "status";

export interface RegistrationQuery {
  search?: string;
  status?: RegistrationStatus;
  /** Narrow to one fee state — the desk's own question, "who has not paid?". */
  fee?: FeeStatus;
  teamId?: string;
  sort?: RegistrationSort;
  page: number;
  pageSize: number;
}

export interface RegistrationPage {
  rows: RegistrationRow[];
  total: number; // rows matching the filter (for pagination)
  page: number;
  pageSize: number;
}

const SORTS: Record<RegistrationSort, SQL[]> = {
  recent: [desc(registrations.createdAt), asc(registrations.id)],
  oldest: [asc(registrations.createdAt), asc(registrations.id)],
  name: [asc(people.name), asc(registrations.id)],
  number: [asc(registrations.registrationNumber), asc(registrations.id)],
  status: [asc(registrations.status), asc(registrations.registrationNumber)],
};

/**
 * Deterministic server-driven query. Search matches name / phone / registration
 * number / team name (exact-ish `ILIKE`, no fuzzy). Every sort has a stable
 * tiebreak on id so pagination never drops or repeats a row.
 */
export async function queryRegistrations(
  db: Db,
  competitionId: string,
  query: RegistrationQuery,
): Promise<RegistrationPage> {
  const filters: SQL[] = [eq(registrations.competitionId, competitionId)];
  if (query.status !== undefined) {
    filters.push(eq(registrations.status, query.status));
  }
  if (query.fee !== undefined) {
    filters.push(eq(registrations.feeStatus, query.fee));
  }
  if (query.teamId !== undefined && query.teamId !== "") {
    filters.push(eq(registrations.teamId, query.teamId));
  }
  const term = query.search?.trim();
  if (term !== undefined && term !== "") {
    const like = `%${term}%`;
    const clause = or(
      ilike(people.name, like),
      ilike(people.phone, like),
      ilike(registrations.registrationNumber, like),
      ilike(teams.name, like),
    );
    if (clause !== undefined) {
      filters.push(clause);
    }
  }
  const where = and(...filters);

  const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
  const page = Math.max(query.page, 1);
  const order = SORTS[query.sort ?? "recent"];

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(where);
  const total = countRow?.count ?? 0;

  const raw = await db
    .select({
      id: registrations.id,
      number: registrations.registrationNumber,
      personId: registrations.personId,
      name: people.name,
      phone: people.phone,
      role: registrations.role,
      status: registrations.status,
      teamId: registrations.teamId,
      teamName: teams.name,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
      isCaptain: registrations.isCaptain,
      feeStatus: registrations.feeStatus,
      feeAmountPaise: registrations.feeAmountPaise,
      feeReference: registrations.feeReference,
      note: registrations.note,
      jerseyName: registrations.jerseyName,
      jerseyNumber: registrations.jerseyNumber,
      tshirtSize: registrations.tshirtSize,
      trouserSize: registrations.trouserSize,
      fatherName: registrations.fatherName,
      basePriceBand: registrations.basePriceBand,
      rejectionReason: registrations.rejectionReason,
      rejectionNote: registrations.rejectionNote,
      photoKey: people.photoUrl,
      photoConsentAt: people.photoConsentAt,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const dupKeys = await duplicateNameKeys(db, competitionId);
  const now = new Date();
  const rows: RegistrationRow[] = raw.map(({ photoKey, photoConsentAt, dateOfBirth, ...r }) => ({
    ...r,
    duplicateName: dupKeys.has(nameKey(r.name)),
    // DPDP §5 render gate: a stored photo only surfaces with recorded consent.
    photoUrl: photoConsentAt !== null && photoKey !== null ? storage.readUrl(photoKey) : null,
    age: deriveAge(dateOfBirth, now),
  }));
  return { rows, total, page, pageSize };
}

/**
 * Every registration as a photo-match target (bulk photo import). The full,
 * unpaged set on purpose: filename matching must see the whole competition or
 * "matches more than one player" would depend on which page was open. Name,
 * number and phone only — the matcher runs client-side and none of this leaves
 * the review-gated dashboard.
 */
export async function photoTargetsOf(db: Db, competitionId: string): Promise<PhotoTarget[]> {
  const rows = await db
    .select({
      registrationId: registrations.id,
      number: registrations.registrationNumber,
      name: people.name,
      phone: people.phone,
      photoUrl: people.photoUrl,
      photoConsentAt: people.photoConsentAt,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(eq(registrations.competitionId, competitionId))
    .orderBy(asc(registrations.registrationNumber));
  return rows.map(({ photoUrl, photoConsentAt, ...row }) => ({
    ...row,
    hasPhoto: photoUrl !== null && photoConsentAt !== null,
  }));
}

/**
 * DA-35: what a signed-OUT visitor may be shown about a registration link.
 * The link was a login wall that never named the tournament — a stranger was
 * asked to prove their phone number before being told what for. This is the
 * "what for": the season, when it is, and where. Public seasons only; a private
 * season's very name is not a stranger's to read.
 */
export async function publicRegistrationFacts(
  db: Db,
  slug: string,
): Promise<{
  name: string;
  status: string;
  entryCategory: "open" | "men" | "women" | "mixed";
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
} | null> {
  const [row] = await db
    .select({
      name: competitions.name,
      status: competitions.status,
      entryCategory: competitions.entryCategory,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
    })
    .from(competitions)
    .where(and(eq(competitions.slug, slug), eq(competitions.visibility, "public")))
    .limit(1);
  return row ?? null;
}

export interface KitSizeCount {
  /** The size as the club wrote it, trimmed and upper-cased for grouping. */
  size: string;
  count: number;
}

export interface KitSummary {
  tshirt: KitSizeCount[];
  trouser: KitSizeCount[];
  /** Approved players with no size recorded — the ones still to chase. */
  missing: number;
}

/**
 * WHAT TO ORDER, which is the only question this block was collected to answer.
 *
 * A club imports two hundred sizes to place a kit order, and an order is
 * counts: forty large, twelve extra-large. The rows held it and nothing added
 * them up, so the organizer exported to Excel and wrote a pivot table — for a
 * sum the product could have done.
 *
 * GROUPED ON A NORMALIZED KEY, and honestly. Sizes are free text, so a file
 * can hold "L", "l" and " L " for one size; those are folded together because
 * they are plainly one answer. "Large" is NOT folded into "L" — it might be,
 * but guessing which spellings mean the same size is how an order comes back
 * wrong, and a club that sees both listed knows to tidy their sheet before
 * they ring the supplier. The value mapper on the import is the place to fix
 * that properly.
 *
 * APPROVED ONLY. A kit order is placed for the players who are in, and counting
 * declined applicants would buy shirts for people who are not coming.
 */
export async function kitSummary(db: Db, competitionId: string): Promise<KitSummary> {
  const rows = await db
    .select({
      tshirt: registrations.tshirtSize,
      trouser: registrations.trouserSize,
      count: sql<number>`count(*)::int`,
    })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), eq(registrations.status, "approved")),
    )
    .groupBy(registrations.tshirtSize, registrations.trouserSize);

  const tally = new Map<string, Map<string, number>>([
    ["tshirt", new Map()],
    ["trouser", new Map()],
  ]);
  let missing = 0;
  for (const row of rows) {
    const shirt = (row.tshirt ?? "").trim().toUpperCase();
    const trouser = (row.trouser ?? "").trim().toUpperCase();
    if (shirt === "" && trouser === "") {
      missing += row.count;
    }
    for (const [key, value] of [
      ["tshirt", shirt],
      ["trouser", trouser],
    ] as const) {
      if (value !== "") {
        const bucket = tally.get(key) as Map<string, number>;
        bucket.set(value, (bucket.get(value) ?? 0) + row.count);
      }
    }
  }
  // Biggest order first, then alphabetically so two equal sizes do not swap
  // places between two reads of the same season.
  const ordered = (key: string): KitSizeCount[] =>
    [...(tally.get(key) as Map<string, number>).entries()]
      .map(([size, count]) => ({ size, count }))
      .sort((a, b) => b.count - a.count || a.size.localeCompare(b.size));
  return { tshirt: ordered("tshirt"), trouser: ordered("trouser"), missing };
}

export interface OrphanPreSigned {
  id: string;
  number: string;
  name: string | null;
  /** Which mark took them out of the pool — the warning has to say which. */
  kind: "icon" | "retained";
}

/**
 * Approved players who are pre-signed to nobody — named, so the warning can be
 * acted on rather than merely counted. Review-gated by the caller (these are
 * applicant names).
 *
 * COVERS RETENTION TOO, and used to cover only icons. A pre-signed player with
 * no team disappears twice over: `auctionReady` drops them from the pool and
 * `preSignedPlayers` discards null-team rows, so they are in no auction and in
 * no squad — an approved player the season has silently lost. That is true of a
 * teamless retained player in precisely the way it is true of a teamless icon,
 * and while `is_retained` had no writer it could only be reached by hand-written
 * SQL. It has a writer now, so one click can create the state, and one click
 * creating a state the product does not mention is the shape of the original
 * defect this warning was added for.
 */
export async function orphanPreSigned(db: Db, competitionId: string): Promise<OrphanPreSigned[]> {
  const rows = await db
    .select({
      id: registrations.id,
      number: registrations.registrationNumber,
      name: people.name,
      isIcon: registrations.isIcon,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        eq(registrations.status, "approved"),
        or(eq(registrations.isIcon, true), eq(registrations.isRetained, true)),
        sql`${registrations.teamId} is null`,
      ),
    )
    .orderBy(asc(registrations.registrationNumber));
  // Icon wins where a player is both, the same precedence `outcomeOf` uses on
  // the poster — one player must not be described two different ways by two
  // surfaces reading one row.
  return rows.map(({ isIcon, ...rest }) => ({ ...rest, kind: isIcon ? "icon" : "retained" }));
}

/** Name keys that appear on >1 registration in this competition (dup/conflict flag). */
export async function duplicateNameKeys(db: Db, competitionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: sql<string>`lower(btrim(regexp_replace(${people.name}, '\\s+', ' ', 'g')))` })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(and(eq(registrations.competitionId, competitionId), sql`${people.name} is not null`))
    .groupBy(sql`1`)
    .having(sql`count(*) > 1`);
  return new Set(rows.map((r) => r.key));
}

export interface TimelineEntry {
  action: string;
  at: Date;
  meta: unknown;
  /**
   * DA-35: the timeline read "IMPORTED · APPROVE · MARKS_SET" and named nobody,
   * while `audit_log.actor` held the answer the whole time. An audit trail that
   * cannot say who is a log, not a trail.
   */
  actorName: string | null;
}

/**
 * A registration's audit timeline (transitions + notes), oldest→newest.
 *
 * Object-level scoping (PRR P1-1): filtering on `auditLog.subject` alone trusts
 * a caller-supplied id, so under an RLS-inert misconfiguration an organizer of
 * competition A could read competition B's registration timeline by passing its
 * id. The INNER join to `registrations` scoped by `competitionId` is the
 * app-layer boundary that does not depend on RLS being live: a foreign id
 * matches no row and yields an empty timeline.
 */
export async function timelineOf(
  db: Db,
  registrationId: string,
  competitionId: string,
): Promise<TimelineEntry[]> {
  return (
    db
      .select({
        action: auditLog.action,
        at: auditLog.at,
        meta: auditLog.meta,
        actorName: people.name,
      })
      .from(auditLog)
      // INNER join: the entry is returned only when its subject is a
      // registration in THIS competition — the ownership check.
      .innerJoin(
        registrations,
        and(eq(registrations.id, auditLog.subject), eq(registrations.competitionId, competitionId)),
      )
      // LEFT join: a system actor (import runner, engine) has no people row, and
      // an entry with no name must still appear.
      .leftJoin(people, eq(people.id, auditLog.actor))
      .where(eq(auditLog.subject, registrationId))
      .orderBy(asc(auditLog.at))
  );
}

/**
 * Deterministic CSV export — stable order (by registration number), competition-
 * scoped by the caller's capability + tenant resolution (no cross-tenant leakage).
 */
export async function exportRegistrationsCsv(
  db: Db,
  competitionId: string,
  /** Narrow to one squad — the Teams tab's per-team export (DA-34). */
  teamId?: string,
): Promise<string> {
  const rows = await db
    .select({
      number: registrations.registrationNumber,
      name: people.name,
      phone: people.phone,
      role: registrations.role,
      status: registrations.status,
      team: teams.name,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      isRetained: registrations.isRetained,
      feeStatus: registrations.feeStatus,
      feeAmountPaise: registrations.feeAmountPaise,
      feeReference: registrations.feeReference,
      jerseyName: registrations.jerseyName,
      jerseyNumber: registrations.jerseyNumber,
      tshirtSize: registrations.tshirtSize,
      trouserSize: registrations.trouserSize,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(
      teamId === undefined
        ? eq(registrations.competitionId, competitionId)
        : and(eq(registrations.competitionId, competitionId), eq(registrations.teamId, teamId)),
    )
    .orderBy(asc(registrations.registrationNumber), asc(registrations.id));
  /*
   * THE EXPORT ROUND-TRIPS THROUGH THE IMPORT, which it did not.
   *
   * `team` was already here and the import could not read it, so an organizer
   * who exported a roster, corrected a phone number in Excel and imported it
   * back lost every squad affiliation in the file they had just been given. The
   * import understands all four of these columns now, and the header names it
   * writes are the canonical ones, so a re-import needs no mapping step at all.
   *
   * Yes/no rather than true/false because a person reads this in Excel, and
   * `parseCsvFlag` takes either.
   */
  const yesNo = (value: boolean): string => (value ? "yes" : "no");
  return toCsv(
    [
      "registration_number",
      "name",
      "phone",
      "role",
      "status",
      "team",
      "is_icon",
      "is_captain",
      "is_retained",
      // The desk, which this export could not answer for either. Canonical
      // header names, so a club can fix a payment in Excel and import it back.
      "fee_status",
      "fee_amount",
      "fee_reference",
      /*
       * THE KIT, which is the whole reason this block is collected. A jersey
       * order IS a spreadsheet a club sends a vendor, so the export matters
       * more here than any screen does — and it wrote none of it.
       *
       * `father_name` is deliberately NOT here. It is an identity check on an
       * entry form, not kit, and this file is handed to a supplier; a list of
       * players' fathers has no business on it. It renders on the record
       * instead, where the organizer already sees the phone number.
       */
      "jersey_name",
      "jersey_number",
      "tshirt_size",
      "trouser_size",
    ],
    rows.map((r) => [
      r.number,
      r.name ?? "",
      // Blank rather than "null" in a spreadsheet cell: an export is read by a
      // person, and an email-anchored player (0062) simply has no number.
      r.phone ?? "",
      r.role ?? "",
      r.status,
      r.team ?? "",
      yesNo(r.isIcon),
      yesNo(r.isCaptain),
      yesNo(r.isRetained),
      r.feeStatus,
      // RUPEES, because the import reads rupees and a round-trip has to close.
      // Blank rather than 0 for an unrecorded amount: they are different facts
      // and writing zero would tell the next reader the fee was free.
      r.feeAmountPaise === null ? "" : String(r.feeAmountPaise / 100),
      r.feeReference ?? "",
      r.jerseyName ?? "",
      r.jerseyNumber ?? "",
      r.tshirtSize ?? "",
      r.trouserSize ?? "",
    ]),
  );
}

/**
 * Record that registrant data LEFT the system. An export is the one read on this
 * screen that produces a durable artefact — hundreds of civilians' names and
 * phone numbers in a file — and it was the only one that wrote no evidence. Who
 * took it, when, how many rows and which squad now sit on the same append-only
 * ledger as every triage decision (DPDP accountability, §8).
 */
export async function recordRegistrationExport(
  db: Db,
  orgId: string,
  competitionId: string,
  actorId: string,
  detail: { rowCount: number; teamId?: string; filename: string },
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "registration.exported",
    scopeType: "org",
    scopeId: orgId,
    // Subject is the competition: the export is an act on the whole intake,
    // not on any one registration, so it must not land in a player's timeline.
    subject: competitionId,
    meta: {
      rowCount: String(detail.rowCount),
      filename: detail.filename,
      ...(detail.teamId !== undefined ? { teamId: detail.teamId } : {}),
    },
  });
}

/** Bulk existence check for a set of ids in a competition (aggregate helper). */
export async function registrationStatuses(
  db: Db,
  competitionId: string,
  ids: readonly string[],
): Promise<{ id: string; status: RegistrationStatus }[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({ id: registrations.id, status: registrations.status })
    .from(registrations)
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        inArray(registrations.id, ids as string[]),
      ),
    );
}
