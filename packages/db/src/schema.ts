import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// IP-2_DESIGN §4. ids are ULIDs (char 26, app-generated via newId()).
// Personal data lives here — the DPDP data map (M-IP2-4) indexes these tables.

const id = () => char("id", { length: 26 }).primaryKey();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const people = pgTable("people", {
  id: id(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  // C-25 × DPDP (R-9): consent designed now, captured at IP-3 registration.
  photoConsentAt: ts("photo_consent_at"),
  photoConsentVia: text("photo_consent_via"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdBy: char("created_by", { length: 26 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: char("org_id", { length: 26 }).notNull(),
    personId: char("person_id", { length: 26 }).notNull(),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.personId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    personId: char("person_id", { length: 26 }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    userAgent: text("user_agent"),
  },
  (table) => [index("sessions_person_idx").on(table.personId)],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    // Per-IP throttling (M-IP2-2 hardening); IPs age out with the codes.
    requestIp: text("request_ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("otp_codes_phone_idx").on(table.phone, table.createdAt),
    index("otp_codes_ip_idx").on(table.requestIp, table.createdAt),
  ],
);

// Development-only delivery target for the DevInboxSender (IP-2_DESIGN D3).
export const otpInbox = pgTable("otp_inbox", {
  id: id(),
  phone: text("phone").notNull(),
  code: text("code").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: id(),
    personId: char("person_id", { length: 26 }).notNull(),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports"),
    // Device naming (M-IP2-2): "Praveen's iPhone" beats a credential hash.
    name: text("name").notNull().default("Passkey"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
  },
  (table) => [index("passkey_person_idx").on(table.personId)],
);

export const grants = pgTable(
  "grants",
  {
    id: id(),
    personId: char("person_id", { length: 26 }).notNull(),
    scopeType: text("scope_type", { enum: ["org", "tournament", "team"] }).notNull(),
    scopeId: char("scope_id", { length: 26 }).notNull(),
    capabilitySet: text("capability_set").notNull(),
    grantedBy: char("granted_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (table) => [
    index("grants_person_idx").on(table.personId),
    index("grants_scope_idx").on(table.scopeType, table.scopeId),
  ],
);

export const invites = pgTable("invites", {
  id: id(),
  orgId: char("org_id", { length: 26 }).notNull(),
  capabilitySet: text("capability_set").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: char("created_by", { length: 26 }).notNull(),
  expiresAt: ts("expires_at").notNull(),
  acceptedBy: char("accepted_by", { length: 26 }),
  acceptedAt: ts("accepted_at"),
  revokedAt: ts("revoked_at"),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actor: char("actor", { length: 26 }).notNull(),
    action: text("action").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: char("scope_id", { length: 26 }).notNull(),
    subject: text("subject"),
    meta: jsonb("meta"),
    at: ts("at").notNull().defaultNow(),
  },
  (table) => [index("audit_scope_idx").on(table.scopeType, table.scopeId, table.at)],
);

// --- Competition domain (IP-3 §4). Every row is org-scoped (C-13, invariant 1);
// RLS (read USING + write WITH CHECK) is applied in migration 0005 from day one.

export const seasons = pgTable(
  "seasons",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("seasons_org_idx").on(table.orgId)],
);

export const competitions = pgTable(
  "competitions",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    seasonId: char("season_id", { length: 26 }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status", {
      enum: ["draft", "setup", "registration_open", "registration_closed"],
    })
      .notNull()
      .default("draft"),
    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    location: text("location"),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("competitions_org_idx").on(table.orgId)],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    primaryColor: text("primary_color"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // Team name is unique within a competition (doc 43).
  (table) => [
    uniqueIndex("teams_competition_name_uq").on(table.competitionId, table.name),
    index("teams_competition_idx").on(table.competitionId),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    personId: char("person_id", { length: 26 }).notNull(),
    role: text("role", {
      enum: ["batter", "bowler", "all_rounder", "wicket_keeper"],
    }).notNull(),
    status: text("status", {
      enum: ["draft", "submitted", "approved", "rejected", "waitlisted", "withdrawn"],
    })
      .notNull()
      .default("submitted"),
    // Human-quotable reference derived from the id (M-IP3-2 search).
    registrationNumber: text("registration_number").notNull().default(""),
    // Optional pre-auction organizer grouping (M-IP3-2 team filter). NOT squad
    // membership — that is an auction projection (doc 43, IP-4).
    teamId: char("team_id", { length: 26 }),
    basePriceBand: text("base_price_band"),
    rejectionReason: text("rejection_reason"),
    rejectionNote: text("rejection_note"),
    reviewedBy: char("reviewed_by", { length: 26 }),
    reviewedAt: ts("reviewed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // One registration per person per competition (doc 42 duplicate rule).
  (table) => [
    uniqueIndex("registrations_competition_person_uq").on(table.competitionId, table.personId),
    index("registrations_competition_idx").on(table.competitionId),
    index("registrations_person_idx").on(table.personId),
    index("registrations_number_idx").on(table.registrationNumber),
    index("registrations_team_idx").on(table.teamId),
  ],
);

// --- Fixtures & venues (M-IP3-3). Org-scoped; RLS read+write in migration 0007.
// Venue → Ground is the physical hierarchy; fixtures reference GROUNDS only —
// venue information is never duplicated onto a fixture row.

export const venues = pgTable(
  "venues",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    address: text("address"),
    city: text("city"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // One venue name per org — venue information exists exactly once.
  (table) => [
    uniqueIndex("venues_org_name_uq").on(table.orgId, table.name),
    index("venues_org_idx").on(table.orgId),
  ],
);

export const grounds = pgTable(
  "grounds",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    venueId: char("venue_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    surface: text("surface", {
      enum: ["turf", "matting", "astroturf", "concrete", "other"],
    })
      .notNull()
      .default("turf"),
    capacity: integer("capacity"),
    floodlights: boolean("floodlights").notNull().default(false),
    indoor: boolean("indoor").notNull().default(false),
    status: text("status", { enum: ["active", "unavailable"] })
      .notNull()
      .default("active"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("grounds_venue_name_uq").on(table.venueId, table.name),
    index("grounds_org_idx").on(table.orgId),
    index("grounds_venue_idx").on(table.venueId),
  ],
);

export const fixtures = pgTable(
  "fixtures",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    // Deterministic human reference (MPL26-F001) — derived once, stable forever.
    fixtureNumber: text("fixture_number").notNull(),
    // Per-competition creation sequence: the number's source, unique under race.
    seq: integer("seq").notNull(),
    round: integer("round"),
    homeTeamId: char("home_team_id", { length: 26 }).notNull(),
    awayTeamId: char("away_team_id", { length: 26 }).notNull(),
    groundId: char("ground_id", { length: 26 }),
    // Local wall-clock "YYYY-MM-DDTHH:MM" (matches competitions.starts_on TEXT
    // discipline): lexicographic order IS chronological order, byte-stable for
    // export/import, no timezone drift in a local-first deployment.
    kickoffAt: text("kickoff_at"),
    durationMinutes: integer("duration_minutes"),
    status: text("status", {
      enum: ["draft", "scheduled", "published", "in_progress", "completed", "cancelled"],
    })
      .notNull()
      .default("draft"),
    cancelReason: text("cancel_reason"),
    publishedAt: ts("published_at"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    cancelledAt: ts("cancelled_at"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fixtures_competition_seq_uq").on(table.competitionId, table.seq),
    uniqueIndex("fixtures_competition_number_uq").on(table.competitionId, table.fixtureNumber),
    // Calendar/timeline queries page on (kickoff, seq) — indexed for 500+.
    index("fixtures_competition_kickoff_idx").on(table.competitionId, table.kickoffAt),
    index("fixtures_ground_kickoff_idx").on(table.groundId, table.kickoffAt),
    index("fixtures_org_kickoff_idx").on(table.orgId, table.kickoffAt),
  ],
);

// --- Auction engine foundation (IP-4, M-IP4-1). Org-scoped; RLS read+write in
// migration 0008. Money columns are integer paise (bigint — C-7, no floats);
// timer instants are integer epoch milliseconds (the deterministic core model).
// auction_events is the APPEND-ONLY replay log: (auction_id, seq) is the total
// order and the fairness proof (doc 41 single-writer).

export const auctions = pgTable(
  "auctions",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["scheduled", "live", "paused", "completed", "reconciled", "abandoned"],
    })
      .notNull()
      .default("scheduled"),
    // AuctionConfig (doc 41), locked at creation; changes are audited overrides.
    config: jsonb("config").notNull(),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("auctions_org_idx").on(table.orgId),
    index("auctions_competition_idx").on(table.competitionId),
  ],
);

export const paddles = pgTable(
  "paddles",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    teamId: char("team_id", { length: 26 }).notNull(),
    personId: char("person_id", { length: 26 }).notNull(),
    paddleNumber: text("paddle_number").notNull(),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    // M-IP4-2 claims: identity stays immutable; a release ENDS the claim. A
    // released paddle never bids again and its number is never reissued.
    releasedAt: ts("released_at"),
  },
  // One ACTIVE paddle per team per auction; numbers never reused (all rows).
  (table) => [
    uniqueIndex("paddles_auction_team_active_uq")
      .on(table.auctionId, table.teamId)
      .where(sql`released_at is null`),
    uniqueIndex("paddles_auction_number_uq").on(table.auctionId, table.paddleNumber),
    index("paddles_auction_idx").on(table.auctionId),
  ],
);

export const lots = pgTable(
  "lots",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    registrationId: char("registration_id", { length: 26 }).notNull(),
    lotNumber: text("lot_number").notNull(),
    seq: integer("seq").notNull(), // deterministic queue order
    basePrice: bigint("base_price", { mode: "number" }).notNull(),
    status: text("status", {
      enum: [
        "prepared",
        "queued",
        "on_block",
        "closing_soon",
        "sold",
        "unsold",
        "frozen",
        "withdrawn",
      ],
    })
      .notNull()
      .default("prepared"),
    roundsUsed: integer("rounds_used").notNull().default(0),
    endsAtMs: bigint("ends_at_ms", { mode: "number" }),
    heldRemainingMs: bigint("held_remaining_ms", { mode: "number" }),
    timerExtensions: integer("timer_extensions").notNull().default(0),
    soldToPaddleId: char("sold_to_paddle_id", { length: 26 }),
    soldPrice: bigint("sold_price", { mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lots_auction_seq_uq").on(table.auctionId, table.seq),
    uniqueIndex("lots_auction_number_uq").on(table.auctionId, table.lotNumber),
    uniqueIndex("lots_auction_registration_uq").on(table.auctionId, table.registrationId),
    index("lots_auction_status_idx").on(table.auctionId, table.status),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    lotId: char("lot_id", { length: 26 }).notNull(),
    paddleId: char("paddle_id", { length: 26 }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: text("status", { enum: ["accepted", "outbid", "invalidated"] })
      .notNull()
      .default("accepted"),
    // The immutable evidence link: the BidAccepted event's (auction, seq).
    eventSeq: integer("event_seq").notNull(),
    placedAtMs: bigint("placed_at_ms", { mode: "number" }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bids_auction_event_uq").on(table.auctionId, table.eventSeq),
    index("bids_lot_idx").on(table.lotId, table.eventSeq),
    index("bids_auction_idx").on(table.auctionId),
  ],
);

export const auctionEvents = pgTable(
  "auction_events",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    atMs: bigint("at_ms", { mode: "number" }).notNull(),
    actor: char("actor", { length: 26 }).notNull(),
    correlationId: char("correlation_id", { length: 26 }).notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // The unique (auction, seq) IS the single-writer total order: a concurrent
  // writer fails loudly instead of interleaving silently.
  (table) => [
    uniqueIndex("auction_events_auction_seq_uq").on(table.auctionId, table.seq),
    index("auction_events_auction_idx").on(table.auctionId),
  ],
);

// --- Owner model (IP-4, M-IP4-3). The production paddle rule: no active paddle
// without an explicit grant. Invitation → acceptance → grant → claim; every
// step is an auction EVENT too (the ledger and replay carry the same history).
// Tokens are stored only as hashes (the IP-2 invite discipline).

export const auctionOwnerInvites = pgTable(
  "auction_owner_invites",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    teamId: char("team_id", { length: 26 }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: char("created_by", { length: 26 }).notNull(),
    expiresAt: ts("expires_at").notNull(),
    acceptedBy: char("accepted_by", { length: 26 }),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("owner_invites_auction_idx").on(table.auctionId)],
);

export const paddleGrants = pgTable(
  "paddle_grants",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    teamId: char("team_id", { length: 26 }).notNull(),
    personId: char("person_id", { length: 26 }).notNull(),
    grantedBy: char("granted_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  // One ACTIVE grant per (auction, team, person); history survives revocation.
  (table) => [
    uniqueIndex("paddle_grants_active_uq")
      .on(table.auctionId, table.teamId, table.personId)
      .where(sql`revoked_at is null`),
    index("paddle_grants_auction_idx").on(table.auctionId),
    index("paddle_grants_person_idx").on(table.personId),
  ],
);

// --- Settlement (IP-5, M-IP5-1). Purely additive: nothing above this line changes.
// Org-scoped; RLS read+write in migration 0011. Money is integer paise (bigint).
// settlement_events is the APPEND-ONLY log of THREE streams (case · journal ·
// payment) — the unique (stream_type, stream_id, seq) is the single-writer total
// order, exactly as (auction_id, seq) is for the frozen auction log. Every other
// settlement table below it is a DISPOSABLE projection, rebuildable from events.

export const settlementEvents = pgTable(
  "settlement_events",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    streamType: text("stream_type", { enum: ["case", "journal", "payment"] }).notNull(),
    // caseId · orgId (the journal is per-org) · paymentId — all ULIDs.
    streamId: char("stream_id", { length: 26 }).notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    atMs: bigint("at_ms", { mode: "number" }).notNull(),
    actor: char("actor", { length: 26 }).notNull(),
    correlationId: char("correlation_id", { length: 26 }).notNull(),
    // The idempotency key of the CAUSE: a ULID for human commands, a derived id
    // (`case:{id}:{seq}:{policy}`) for coordinated ones — so a policy re-run
    // after a crash returns the original ack instead of posting twice.
    commandId: text("command_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("settlement_events_stream_seq_uq").on(table.streamType, table.streamId, table.seq),
    uniqueIndex("settlement_events_command_uq").on(
      table.streamType,
      table.streamId,
      table.commandId,
    ),
    index("settlement_events_stream_idx").on(table.streamType, table.streamId),
    index("settlement_events_org_idx").on(table.orgId),
  ],
);

export const settlementCases = pgTable(
  "settlement_cases",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    status: text("status", {
      enum: ["opened", "verified", "discrepant", "settling", "settled", "closed", "voided"],
    })
      .notNull()
      .default("opened"),
    basis: text("basis", { enum: ["committed", "fixed", "none"] }).notNull(),
    // The intake PIN: what the frozen auction log looked like when trusted.
    sourceEventCount: integer("source_event_count").notNull(),
    sourceDigest: text("source_digest").notNull(),
    foldDigest: text("fold_digest"),
    // Closure (M-IP5-3): the immutable evidence package + the closed anchor.
    // Both are re-derivable from the CaseClosed event — this column is a
    // disposable projection, rebuilt by recovery, verified against the log.
    closureEvidence: jsonb("closure_evidence"),
    closedAtSeq: integer("closed_at_seq"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // One live case per auction; a voided case never blocks a fresh attempt.
  (table) => [
    uniqueIndex("settlement_cases_auction_live_uq")
      .on(table.auctionId)
      .where(sql`status <> 'voided'`),
    index("settlement_cases_org_idx").on(table.orgId),
  ],
);

export const settlementObligations = pgTable(
  "settlement_obligations",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    caseId: char("case_id", { length: 26 }).notNull(),
    teamId: char("team_id", { length: 26 }).notNull(),
    // Every counter is NON-NEGATIVE money; outstanding is DERIVED from them and
    // stored nowhere (invariant: no balance has a column).
    amount: bigint("amount", { mode: "number" }).notNull(),
    increased: bigint("increased", { mode: "number" }).notNull().default(0),
    reduced: bigint("reduced", { mode: "number" }).notNull().default(0),
    discharged: bigint("discharged", { mode: "number" }).notNull().default(0),
    waived: bigint("waived", { mode: "number" }).notNull().default(0),
    reinstated: bigint("reinstated", { mode: "number" }).notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("settlement_obligations_case_team_uq").on(table.caseId, table.teamId),
    index("settlement_obligations_org_idx").on(table.orgId),
  ],
);

export const journalPostings = pgTable(
  "journal_postings",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    // The journal stream is per-org, so (org, event seq) is the posting's place
    // in the one total order money moves in.
    eventSeq: integer("event_seq").notNull(),
    template: text("template", {
      enum: ["obligation", "collection", "overpaid-collection", "waiver", "refund"],
    }).notNull(),
    caseId: char("case_id", { length: 26 }),
    teamId: char("team_id", { length: 26 }),
    // Provenance: the event that caused it. ONE cause, ONE posting.
    sourceStream: text("source_stream").notNull(),
    sourceSeq: integer("source_seq").notNull(),
    memo: text("memo"),
    atMs: bigint("at_ms", { mode: "number" }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("journal_postings_org_event_uq").on(table.orgId, table.eventSeq),
    uniqueIndex("journal_postings_source_uq").on(table.orgId, table.sourceStream, table.sourceSeq),
    index("journal_postings_case_idx").on(table.orgId, table.caseId),
  ],
);

export const journalLegs = pgTable(
  "journal_legs",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    postingId: char("posting_id", { length: 26 }).notNull(),
    legIndex: integer("leg_index").notNull(),
    account: text("account").notNull(),
    direction: text("direction", { enum: ["debit", "credit"] }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("journal_legs_posting_index_uq").on(table.postingId, table.legIndex),
    index("journal_legs_account_idx").on(table.orgId, table.account),
  ],
);

export const journalCheckpoints = pgTable(
  "journal_checkpoints",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    seq: integer("seq").notNull(),
    digest: text("digest").notNull(),
    // The canonical fold bytes. Disposable acceleration, never truth: trusted
    // only once a genesis re-fold proves it byte-identical (verified_at).
    bytes: text("bytes").notNull(),
    verifiedAt: ts("verified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("journal_checkpoints_org_seq_uq").on(table.orgId, table.seq)],
);

// --- Collections (IP-5, M-IP5-2). Additive: nothing above changes. The `payments`
// table is the DISPOSABLE projection of the payment stream — one row per attempt,
// rebuildable from settlement_events. Money is integer paise (bigint); the id IS
// the stream id (paymentId). RLS read+write in migration 0012.

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    caseId: char("case_id", { length: 26 }).notNull(),
    teamId: char("team_id", { length: 26 }).notNull(),
    method: text("method", {
      enum: ["gateway:razorpay", "manual:cash", "manual:upi-direct", "manual:bank"],
    }).notNull(),
    status: text("status", {
      enum: ["created", "authorized", "captured", "refunded", "failed", "disputed"],
    })
      .notNull()
      .default("created"),
    // Pinned at initiation; the amount every later provider claim is checked against.
    amount: bigint("amount", { mode: "number" }).notNull(),
    captured: bigint("captured", { mode: "number" }).notNull().default(0),
    refundedTotal: bigint("refunded_total", { mode: "number" }).notNull().default(0),
    attested: boolean("attested").notNull().default(false),
    attestedBy: char("attested_by", { length: 26 }),
    providerRef: text("provider_ref"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("payments_org_idx").on(table.orgId),
    index("payments_case_idx").on(table.caseId),
  ],
);
