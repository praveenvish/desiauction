import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  date,
  primaryKey,
  smallint,
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
  /**
   * NULLABLE SINCE 0062, and still unique. A person is anchored by a phone, an
   * email, or both — never neither (`people_reachable_check`). Postgres allows
   * many NULLs under a unique constraint, so phone-less accounts do not collide
   * while every real number still identifies exactly one person.
   */
  phone: text("phone").unique(),
  name: text("name"),
  // C-25 × DPDP (R-9): consent designed now, captured at IP-3 registration.
  photoConsentAt: ts("photo_consent_at"),
  photoConsentVia: text("photo_consent_via"),
  // Storage KEY (not a signed URL) for the person's photo; signed at read time
  // by the media storage port. Only meaningful once photoConsentAt is set.
  photoUrl: text("photo_url"),
  photoUploadedAt: ts("photo_uploaded_at"),
  /**
   * An address to send documents to — receipts, invoices, corrections.
   *
   * VERIFIED OR ABSENT. `emailVerifiedAt` is what the delivery resolver reads;
   * an address with no timestamp is a string somebody typed, not a channel.
   * Sending a club's receipt to an unverified address is how it reaches a
   * stranger's mailbox because a player fat-fingered a domain.
   */
  email: text("email"),
  emailVerifiedAt: ts("email_verified_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/**
 * THE PERSON'S DURABLE CRICKET IDENTITY (PI-1).
 *
 * One row per person, created lazily on first profile write. This is the
 * SOURCE OF DEFAULTS, not the record of fact: each registration still snapshots
 * the values chosen for that season, so editing a profile never rewrites
 * history and the auction pool keeps reading registrations alone.
 *
 * Gender is deliberately NOT snapshotted anywhere — eligibility reads it here
 * at decision time, and historical rows never embed a fact a person is
 * entitled to correct (DPDP correction right). NULL means "never asked";
 * `unspecified` means "asked, declined" — two different absences.
 *
 * No RLS and no org column, deliberately: like `people`, `sessions` and
 * `consent_records`, this is between the platform and a person, not a club.
 * Every read and write is scoped to the session's own person id in the app
 * layer, and a person-isolation regression test holds that boundary.
 */
export const playerProfiles = pgTable(
  "player_profiles",
  {
    id: id(),
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    gender: text("gender", {
      enum: ["male", "female", "non_binary", "self_described", "unspecified"],
    }),
    /** The person's own words; only meaningful with gender = self_described. */
    genderSelfDescribed: text("gender_self_described"),
    /** ISO yyyy-mm-dd; age is DERIVED at read time, never stored (D2). */
    dateOfBirth: text("date_of_birth"),
    /** City-level free text — no taxonomy; no feature consumes more. */
    location: text("location"),
    preferredJerseyName: text("preferred_jersey_name"),
    preferredJerseyNumber: text("preferred_jersey_number"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("player_profiles_person_uq").on(table.personId)],
);

/**
 * HOW A PERSON PLAYS ONE SPORT (migration 0048).
 *
 * `player_profiles` above is about a PERSON — gender, date of birth, location,
 * jersey — all true of them whatever they play. This is about a PLAYER, which
 * is a person IN A SPORT: somebody can be an all-rounder at cricket and a
 * goalkeeper at football, and one row per person could only ever hold one of
 * those answers.
 *
 * Keyed by (person_id, sport) with no surrogate id: the row IS that pair, and a
 * generated id would be a second way to name the same thing.
 */
export const playerSportProfiles = pgTable(
  "player_sport_profiles",
  {
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    sport: text("sport")
      .notNull()
      .references(() => sports.key),
    /** Validated against the SPORT'S pack — never a column-level list. */
    defaultRole: text("default_role"),
    /** The pack's attribute keys: batting_style, bowling_style, preferred_foot. */
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.personId, table.sport] })],
);

/**
 * Codes that prove an address belongs to the person typing it.
 *
 * Separate from `otp_codes`, whose column is named `phone` and whose indexes
 * are built for sign-in. Person-scoped, because you must already be signed in
 * to add an address — so the code is useless without the session beside it.
 */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: id(),
    /**
     * NULLABLE SINCE 0063, and only for `purpose: "login"` — a sign-UP code is
     * minted before the account exists, and the person is created by the
     * request that proves the code. `email_verifications_person_required_check`
     * holds every `email_change` row to a person, because a code that confirms
     * an address change on nobody is meaningless.
     */
    personId: char("person_id", { length: 26 }).references(() => people.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    /**
     * What this code may prove — the email twin of `otp_codes.purpose`. A code
     * minted to confirm an address must not sign anybody in, and a sign-in code
     * must not silently confirm an address change. That bug already happened on
     * the phone side once; this table is not going to repeat it.
     */
    purpose: text("purpose", { enum: ["email_change", "login"] })
      .notNull()
      .default("email_change"),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    /** Per-IP throttling for the PUBLIC sign-in form — see 0061. */
    requestIp: text("request_ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("email_verifications_person_idx").on(table.personId, table.createdAt),
    index("email_verifications_ip_idx").on(table.requestIp, table.createdAt),
  ],
);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // The club's own words for the Org Detail "About" banner — nullable, edited
  // in place by an owner. Never fabricated; empty until someone writes it.
  description: text("description"),
  createdBy: char("created_by", { length: 26 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: char("org_id", { length: 26 }).notNull(),
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  // PRR P2/F36: the composite PK indexes (org_id, person_id) — good for "who is
  // in this org", useless for "which orgs is this person in", which the org
  // switcher and every person-scoped membership read do. That lookup was a full
  // scan; this index serves it.
  (table) => [
    primaryKey({ columns: [table.orgId, table.personId] }),
    index("org_members_person_idx").on(table.personId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
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
    /**
     * What this code may prove (PI-1). Minted for one purpose, consumable for
     * that purpose alone: before this column, the phone-change flow reused
     * login codes by construction, so a code sent for sign-in could confirm a
     * number change on the same phone. Purposes stay phone-shaped — email
     * codes live in `email_verifications`, which says what it is.
     */
    purpose: text("purpose", { enum: ["login", "phone_change"] })
      .notNull()
      .default("login"),
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

/**
 * WHAT A PERSON AGREED TO, AND WHEN.
 *
 * Append-only. A withdrawal is a new row with `granted = false`, never an
 * update — "did they agree on the day we sent it?" is a question about a moment
 * in the past, and a mutable row cannot answer it. Under the DPDP Act and the
 * DLT regime we have to be able to show when someone agreed, to what, and how
 * they took it back.
 *
 * No RLS and no org column, deliberately: consent is between the platform and a
 * person, not a club. It follows `people`, `sessions` and `otp_codes`, the other
 * identity tables, which carry no tenant policy either.
 */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: id(),
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    /** What they agreed to — "sms.transactional", "sms.promotional". */
    purpose: text("purpose").notNull(),
    granted: boolean("granted").notNull(),
    /** Where the agreement came from, so an audit can retrace it. */
    source: text("source", {
      enum: ["registration", "account", "sms_stop", "sms_start", "import", "support", "login"],
    }).notNull(),
    /** The wording shown, the page, whatever proves what they actually saw. */
    evidence: jsonb("evidence").notNull().default({}),
    requestIp: text("request_ip"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("consent_person_idx").on(table.personId, table.purpose, table.createdAt)],
);

/**
 * WHAT A PERSON WANTS, PER TOPIC AND PER CHANNEL.
 *
 * Distinct from `suppressions`, which is a hard stop keyed by a contact and
 * often arrives from someone with no account. This is the softer, per-account
 * control: "tell me about registrations but not auction reminders."
 *
 * The absence of a row is NOT neutral, and the default differs by category:
 * a transactional topic is allowed until someone turns it off, a promotional
 * one is refused until someone turns it on. That asymmetry is the whole point —
 * you should not have to opt in to being told your own registration was
 * approved, and we should not be able to market at you because you never
 * noticed a switch.
 *
 * Sign-in codes are absent on purpose. They do not pass the preference gate at
 * all, because a person who switches off "SMS" and then cannot log in has been
 * handed a worse outcome than the one they were avoiding.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** `registration`, `auction`, `money`, `marketing`. */
    topic: text("topic").notNull(),
    channel: text("channel", { enum: ["sms", "email", "in-app"] }).notNull(),
    allowed: boolean("allowed").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One live answer per person, per topic, per channel. Changing your mind
    // updates the row — unlike consent, this is a setting and not evidence.
    uniqueIndex("notification_pref_uq").on(table.personId, table.topic, table.channel),
  ],
);

/**
 * WHAT A CLUB CHOOSES TO SEND, PER TOPIC AND PER CHANNEL.
 *
 * The third layer of the same gate, and the only one that belongs to a TENANT
 * rather than to a person. All three can subtract a message; none can cause one.
 *
 * An organizer switching a topic ON cannot override a person who switched it
 * OFF — the person's answer is read first and independently. That is why this is
 * a separate table and not a column on the preference: a club must never be able
 * to write into somebody's consent.
 *
 * Absence means ON, so a club that has never opened the screen keeps sending
 * exactly what it sends today. A new table that silently muted a live product
 * would be a worse bug than the one it fixes.
 */
export const orgMessagingSettings = pgTable(
  "org_messaging_settings",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    topic: text("topic").notNull(),
    channel: text("channel", { enum: ["sms", "email", "in-app"] }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    updatedBy: char("updated_by", { length: 26 }),
  },
  (table) => [uniqueIndex("org_messaging_settings_uq").on(table.orgId, table.topic, table.channel)],
);

/**
 * ADDRESSES WE MUST NOT SEND TO.
 *
 * Keyed by the CONTACT, not by a person, and that is the point: a STOP arrives
 * from a phone number, and a hard bounce from an email address. Neither
 * necessarily maps to an account, and both must be honoured anyway. Continuing
 * to send to a hard bounce is how a sending domain dies; continuing after a STOP
 * is how a sender header gets blocked.
 *
 * `scope` is "global" or a topic, so a person can stop registration texts
 * without losing their sign-in codes — which is why sign-in codes have to be
 * exempt in the UI copy too, or "turn off SMS" locks someone out of their
 * account.
 */
export const suppressions = pgTable(
  "suppressions",
  {
    id: id(),
    /** E.164 phone or a lowercased email — whatever the channel addresses. */
    contact: text("contact").notNull(),
    channel: text("channel", { enum: ["sms", "email"] }).notNull(),
    scope: text("scope").notNull().default("global"),
    reason: text("reason", {
      enum: ["stop", "bounce", "complaint", "manual", "unreachable"],
    }).notNull(),
    /** Set when a STOP is reversed by START, so the row stays as evidence. */
    liftedAt: ts("lifted_at"),
    note: text("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    // The read every send performs: is this contact suppressed on this channel,
    // for this scope, right now.
    index("suppressions_contact_idx").on(table.contact, table.channel, table.scope),
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
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
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
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    // PX-9: "platform" joins the TYPE union — a type-only widening, not a schema
    // change. The column is and always was plain `text` (migration 0000; the
    // drizzle snapshot records no enum), so this emits no migration. It exists
    // so the singleton platform scope can be named in TypeScript. Writing such a
    // row remains impossible for the application role: `grants_tenant`'s WITH
    // CHECK (0004) admits `scope_type = 'org'` only, so the platform grant is
    // installable solely on the RLS-exempt system pool, by the seed.
    scopeType: text("scope_type", { enum: ["org", "tournament", "team", "platform"] }).notNull(),
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

/**
 * The durable name a competition recurs under — "BPL". Each competition
 * pointing at it is one edition: BPL 1, BPL 2, BPL 3. The tournament carries
 * no status of its own; the edition is the thing that runs.
 */
/**
 * WHICH SHIPPED SPORT PACKS ARE LIVE (migration 0046).
 *
 * A flag, never a definition. `key` names a pack in
 * `packages/core/src/sports/`; the foreign keys on `competitions.sport` and
 * `tournaments.sport` then make it impossible for a season to name a sport
 * nothing on this platform can actually run.
 *
 * Seeded by migration, not administered: enabling a sport requires its pack to
 * exist in code, which is a deploy, so the flag cannot usefully move ahead of
 * one. No RLS — global reference data, identical for every tenant.
 */
export const sports = pgTable("sports", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  /** Picker order. Not alphabetical — the likeliest answer belongs on top. */
  sortOrder: integer("sort_order").notNull().default(0),
  addedAt: ts("added_at").notNull().defaultNow(),
});

export const tournaments = pgTable(
  "tournaments",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    /** The sport every edition of this tournament defaults to (0046). */
    sport: text("sport")
      .notNull()
      .references(() => sports.key),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("tournaments_org_idx").on(table.orgId)],
);

/**
 * ASKING FOR MORE ROOM (0028).
 *
 * 0027 gave seasons a tier and the platform began refusing the fifth team on
 * Free. A refusal saying "upgrade the season's pass" with nowhere to do it is a
 * dead end; this is the somewhere.
 *
 * A REQUEST, NOT A PURCHASE. Pro and Association both read "Published at GA" on
 * the pricing page — there is no price for either anywhere in this repository,
 * so a checkout would have to invent the number a customer is charged. An
 * organizer asks, somebody answers, and the answer is recorded. When prices
 * exist, this is the row a payment attaches to.
 */
export const passUpgradeRequests = pgTable("pass_upgrade_requests", {
  id: id(),
  orgId: char("org_id", { length: 26 }).notNull(),
  competitionId: char("competition_id", { length: 26 }).notNull(),
  /** The tier as it stood when they asked — so a granted request still explains
   *  what it moved them from, after the competition row has changed. */
  fromTier: text("from_tier", { enum: ["free", "pro", "association"] }).notNull(),
  requestedTier: text("requested_tier", { enum: ["free", "pro", "association"] }).notNull(),
  /** Why they need it, in their words: the most useful field for whoever answers. */
  note: text("note"),
  requestedBy: char("requested_by", { length: 26 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Null resolution = still open. A partial unique index allows exactly one. */
  resolvedAt: ts("resolved_at"),
  resolvedBy: char("resolved_by", { length: 26 }),
  outcome: text("outcome", { enum: ["granted", "declined"] }),
});

export const competitions = pgTable(
  "competitions",
  {
    id: id(),
    orgId: char("org_id", { length: 26 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** The recurring tournament this is an edition of; null for a one-off. */
    tournamentId: char("tournament_id", { length: 26 }),
    /**
     * WHICH SPORT THIS SEASON IS (0046) — the dimension Phase 0's registry was
     * built to be read by. Defaults to cricket, which is a fact and not a
     * guess: every row that existed when the column landed was cricket, because
     * there had never been a way to create anything else. The default is
     * dropped in Phase 2, when a second pack makes it a lie.
     */
    sport: text("sport")
      .notNull()
      .references(() => sports.key),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status", {
      enum: ["draft", "setup", "registration_open", "registration_closed"],
    })
      .notNull()
      .default("draft"),
    /**
     * What this season's pass covers (RH-1e). Default `free` — the honest
     * default for anything created from here on; every row that existed when
     * the column landed was backfilled to `association`, because the pricing
     * page promises that tournaments started during beta stay free forever
     * with every tier, and a four-team ceiling applied retroactively would
     * break that against the people who took it.
     */
    tier: text("tier", { enum: ["free", "pro", "association"] })
      .notNull()
      .default("free"),
    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    /**
     * Who this season is for (PI-1) — the competition-level half of the gender
     * model. `open` is the honest default for every row that predates the
     * column. Enforcement lives ONLY in core's eligibility engine; public
     * surfaces read this for terminology ("Women's", "Open") and nothing else.
     */
    entryCategory: text("entry_category", { enum: ["open", "men", "women", "mixed"] })
      .notNull()
      .default("open"),
    // Storage KEY for the auction crest; signed at read time by the media port.
    logoUrl: text("logo_url"),
    location: text("location"),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("competitions_org_idx").on(table.orgId),
    index("competitions_tournament_idx").on(table.tournamentId),
  ],
);

/**
 * THE TEAM THAT COMES BACK (PI-1 P6) — the 0019 tournaments pattern applied
 * to teams: a durable org-scoped name that editions' team rows point at.
 * Written only by the clone path; read only by career/grouping surfaces.
 * Never an authority — the auction, rosters and money key on `teams` alone.
 */
export const franchises = pgTable(
  "franchises",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("franchises_org_idx").on(table.orgId)],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 })
      .notNull()
      .references(() => competitions.id, { onDelete: "restrict" }),
    /** PI-1 P6: the durable franchise this edition-team is an appearance of;
     *  null for a one-off. Linked by the clone path, read for grouping only. */
    franchiseId: char("franchise_id", { length: 26 }),
    name: text("name").notNull(),
    shortName: text("short_name"),
    primaryColor: text("primary_color"),
    // Storage KEY for the team crest; signed at read time by the media port.
    // Falls back to the monogram + primaryColor swatch when absent.
    logoUrl: text("logo_url"),
    // Non-bidding team staff (organizer metadata; not an authenticated role).
    coachName: text("coach_name"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // Team name is unique within a competition (doc 43).
  (table) => [
    uniqueIndex("teams_competition_name_uq").on(table.competitionId, table.name),
    index("teams_competition_idx").on(table.competitionId),
    index("teams_franchise_idx").on(table.franchiseId),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    /**
     * The playing role, validated against the COMPETITION'S sport pack (0047).
     *
     * No enum here on purpose: the legal values are football's or cricket's
     * depending on the season, and a column-level list could only ever name
     * one sport's. Nullable because `required` is a per-sport fact the pack
     * declares — cricket and football both say true, pickleball has no
     * meaningful role at all.
     */
    role: text("role"),
    status: text("status", {
      enum: ["draft", "submitted", "approved", "rejected", "waitlisted", "withdrawn"],
    })
      .notNull()
      .default("submitted"),
    // Human-quotable reference derived from the id (M-IP3-2 search).
    registrationNumber: text("registration_number").notNull().default(""),
    // Optional pre-auction organizer grouping (M-IP3-2 team filter). NOT squad
    // membership — that is an auction projection (doc 43, IP-4). For icon
    // players (isIcon), teamId IS a pre-signed squad assignment: they are
    // retained to that team and excluded from the auction pool.
    teamId: char("team_id", { length: 26 }),
    // Icon (marquee) player: pre-assigned to their team, not auctioned.
    isIcon: boolean("is_icon").notNull().default(false),
    // Team captain marker (display + team-sheet ordering; not a system role).
    isCaptain: boolean("is_captain").notNull().default(false),
    // Retained player: kept from a prior season, excluded from the pool like an
    // icon. Vice-captain is a display marker only (not a system role).
    isRetained: boolean("is_retained").notNull().default(false),
    isViceCaptain: boolean("is_vice_captain").notNull().default(false),
    // --- Player profile (M-parity: matches the incumbent's player card) ---
    // ISO yyyy-mm-dd; age is DERIVED at read time, never stored (it rots).
    dateOfBirth: text("date_of_birth"),
    // Structured playing style (display + set filtering). Freeform-tolerant text
    // validated against enums in packages/core/src/player-profile.ts.
    battingStyle: text("batting_style"),
    bowlingStyle: text("bowling_style"),
    fatherName: text("father_name"),
    // Kit block — optional; only organizers who order jerseys populate it.
    jerseyName: text("jersey_name"),
    jerseyNumber: text("jersey_number"),
    tshirtSize: text("tshirt_size"),
    trouserSize: text("trouser_size"),
    basePriceBand: text("base_price_band"),
    /**
     * Sport-specific player detail (0047), keyed by the pack's attribute keys.
     *
     * Cricket's `batting_style`/`bowling_style` keep their own columns above —
     * they predate the registry and the pack records that in `AttributeStorage`.
     * Every sport added from football on lands here, so a new pack never costs
     * a migration.
     */
    attributes: jsonb("attributes").notNull().default({}),
    // --- Registration desk (0034). NOT settlement money: an entry fee is desk
    // bookkeeping and never posts to the finops ledger. See the migration.
    feeStatus: text("fee_status", { enum: ["pending", "paid", "waived", "refunded"] })
      .notNull()
      .default("pending"),
    /** Integer paise (C-7, no floats). NULL = no amount recorded, not zero. */
    feeAmountPaise: bigint("fee_amount_paise", { mode: "number" }),
    /** UTR / transaction reference as the player quoted it. */
    feeReference: text("fee_reference"),
    /**
     * The organizer's own remark. DISTINCT from `rejectionNote`, which belongs
     * to a triage decision; this one survives every status change.
     */
    note: text("note"),
    rejectionReason: text("rejection_reason"),
    rejectionNote: text("rejection_note"),
    reviewedBy: char("reviewed_by", { length: 26 }),
    reviewedAt: ts("reviewed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  /*
   * ONE REGISTRATION PER PERSON PER COMPETITION (doc 42 duplicate rule).
   *
   * TOTAL, not partial — including withdrawn rows, deliberately. A withdrawn
   * registration used to be a life sentence: the index refused a second row and
   * `submitRegistration` reported `duplicate`, so a player who withdrew by
   * mistake could never rejoin the season. The fix is NOT to exempt withdrawn
   * rows from the index. It is to REINSTATE the dormant row on re-registration
   * (`withdrawn --restore--> submitted` is the machine's own and only exit from
   * withdrawn), which is what apps/web/src/server/competition/registrations.ts
   * now does.
   *
   * Weakening the index would have created the worse bug: `myRegistration`
   * reads one row per (competition, person) with no ordering, so a player
   * holding a withdrawn row AND a live one would see whichever Postgres
   * returned. Reinstating keeps the registration number stable and keeps the
   * whole history — apply, withdraw, rejoin — on ONE audit timeline.
   */
  (table) => [
    uniqueIndex("registrations_competition_person_uq").on(table.competitionId, table.personId),
    index("registrations_competition_idx").on(table.competitionId),
    index("registrations_person_idx").on(table.personId),
    index("registrations_number_idx").on(table.registrationNumber),
    index("registrations_team_idx").on(table.teamId),
    // DA-04: exactly one captain per team. Partial, so the flag stays free for
    // players not yet on a squad and the invariant cannot be forgotten by the
    // next caller the way it was by the last one.
    uniqueIndex("registrations_team_captain_uq")
      .on(table.teamId)
      .where(sql`${table.isCaptain} and ${table.teamId} is not null`),
    check(
      "registrations_fee_status_check",
      sql`${table.feeStatus} in ('pending', 'paid', 'waived', 'refunded')`,
    ),
    check(
      "registrations_status_check",
      sql`${table.status} in ('draft', 'submitted', 'approved', 'rejected', 'waitlisted', 'withdrawn')`,
    ),
  ],
);

// --- Fixtures & venues (M-IP3-3). Org-scoped; RLS read+write in migration 0007.
// Venue → Ground is the physical hierarchy; fixtures reference GROUNDS only —
// venue information is never duplicated onto a fixture row.

/**
 * HOW THIS CLUB'S REGISTRATION FORM IS READ (migration 0033).
 *
 * `competitionId` null = the org's default mapping; set = an override for one
 * season. Two partial unique indexes keep each rule readable on its own rather
 * than hiding both inside a COALESCE.
 */
export const orgImportMappings = pgTable(
  "org_import_mappings",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }),
    /** Normalized+sorted header fingerprint — a LAYOUT, never player data. */
    signature: text("signature").notNull(),
    label: text("label"),
    /** core's `ColumnMapping`: field -> source column index. */
    mapping: jsonb("mapping").notNull(),
    /** core's `ValueMaps`: field -> { as written: as we understand it }. */
    valueMaps: jsonb("value_maps").notNull().default({}),
    dateOrder: text("date_order", { enum: ["dmy", "mdy"] })
      .notNull()
      .default("dmy"),
    createdBy: char("created_by", { length: 26 }).notNull(),
    updatedBy: char("updated_by", { length: 26 }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("org_import_mappings_org_default_uq")
      .on(table.orgId, table.signature)
      .where(sql`${table.competitionId} is null`),
    uniqueIndex("org_import_mappings_competition_uq")
      .on(table.orgId, table.competitionId, table.signature)
      .where(sql`${table.competitionId} is not null`),
    index("org_import_mappings_org_idx").on(table.orgId),
    check("org_import_mappings_date_order_check", sql`${table.dateOrder} in ('dmy', 'mdy')`),
  ],
);

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

/**
 * WHO WON.
 *
 * A fixture could be scheduled, published, started and marked `completed` while
 * the product recorded nothing about how it went — `fixtures` carries a status
 * and four timestamps and stops. A club could run a whole tournament here and
 * nothing could say who had won a single match.
 *
 * There is no standings table. Everything a league table shows is DERIVED from
 * these rows: a stored table drifts from the results beneath it the first time
 * somebody amends a scorecard, and a derived one cannot.
 *
 * OVERS ARE BALLS. 4.5 overs is four overs and five balls, not 4.5 of anything,
 * and a net run rate computed on that decimal is quietly wrong all season. An
 * integer ball count has none of that; the display converts back at the edge.
 */
export const fixtureResults = pgTable(
  "fixture_results",
  {
    fixtureId: char("fixture_id", { length: 26 }).primaryKey(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    /**
     * `no_result` and `abandoned` are distinct on purpose. A washed-out match
     * that started is a no-result and shares the points; one that never started
     * is abandoned. Leagues treat them differently, and collapsing both into
     * "cancelled" makes the table wrong.
     */
    outcome: text("outcome", {
      enum: ["home_win", "away_win", "tie", "no_result", "abandoned"],
    }).notNull(),
    winnerTeamId: char("winner_team_id", { length: 26 }),
    /**
     * The scoreline, in the shape the season's sport pack declares (0047):
     * `{ home: { runs, wickets, balls }, away: {...} }` for cricket,
     * `{ home: { goals }, away: { goals } }` for football.
     *
     * `outcome`, `winnerTeamId`, `method` and `note` stay as they were — all
     * four were already true in every team sport, which is why replacing the
     * cricket integers was the only change this table needed.
     */
    score: jsonb("score").$type<{
      home?: Record<string, number>;
      away?: Record<string, number>;
    }>(),
    // A lobby's outcome lives in `fixture_participants`, not here: twenty-five
    // squads do not fit a home/away pair, and `outcome` below has no word for
    // "everybody played and nobody beat anybody".

    /** "DLS", "super over", "conceded" — how, when not simply the higher score. */
    method: text("method"),
    note: text("note"),
    recordedBy: char("recorded_by", { length: 26 }).notNull(),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [index("fixture_results_competition_idx").on(table.competitionId)],
);

/**
 * ONE SQUAD'S PLACE IN A LOBBY (0058).
 *
 * A battle royale match is not two sides — it is up to twenty-five squads in
 * one lobby, ranked on where they finished and what they did there. The squads
 * are SCHEDULED into the lobby (a group plays its matches together), so a row
 * exists before anything is played and `placement`/`score` fill in when the
 * result is recorded.
 */
export const fixtureParticipants = pgTable(
  "fixture_participants",
  {
    fixtureId: char("fixture_id", { length: 26 }).notNull(),
    teamId: char("team_id", { length: 26 }).notNull(),
    orgId: char("org_id", { length: 26 }).notNull(),
    competitionId: char("competition_id", { length: 26 }).notNull(),
    /** 1 is the win. Null until the result is in; two squads may share one. */
    placement: integer("placement"),
    /** The squad's own numbers, in the pack's shape — `{ kills: 7 }`. */
    score: jsonb("score").$type<Record<string, number>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.fixtureId, table.teamId] }),
    index("fixture_participants_competition_idx").on(table.competitionId),
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
    /**
     * NULL ON A LOBBY (0058). Every sport here assumed a fixture has two sides
     * until battle royale, whose match is one lobby of up to twenty-five squads
     * with no home and no away — the participants live in
     * `fixture_participants`. A CHECK enforces both-or-neither, so a fixture is
     * a duel or a lobby and never half of each.
     */
    homeTeamId: char("home_team_id", { length: 26 }),
    awayTeamId: char("away_team_id", { length: 26 }),
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
    competitionId: char("competition_id", { length: 26 })
      .notNull()
      .references(() => competitions.id, { onDelete: "restrict" }),
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
    // At most ONE non-abandoned auction per competition (0029). createAuction
    // checks this too, but read-then-insert cannot stop a race; this can.
    uniqueIndex("auctions_competition_active_uq")
      .on(table.competitionId)
      .where(sql`${table.status} <> 'abandoned'`),
    /*
     * THE `enum:` ABOVE IS A TYPE, NOT A COLUMN DEFINITION.
     *
     * drizzle emits plain `text` for it, so before 0030 any string at all was a
     * valid auction status as far as Postgres was concerned. These checks are
     * the same lists, stated where the database can enforce them. Adding a
     * state to the machine in packages/core now means changing three places —
     * deliberately: a state nobody thought about at the database is exactly the
     * class of change worth slowing down.
     */
    check(
      "auctions_status_check",
      sql`${table.status} in ('scheduled', 'live', 'paused', 'completed', 'reconciled', 'abandoned')`,
    ),
  ],
);

export const paddles = pgTable(
  "paddles",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 })
      .notNull()
      .references(() => auctions.id, { onDelete: "restrict" }),
    teamId: char("team_id", { length: 26 }).notNull(),
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
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
    auctionId: char("auction_id", { length: 26 })
      .notNull()
      .references(() => auctions.id, { onDelete: "restrict" }),
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
    check(
      "lots_status_check",
      sql`${table.status} in ('prepared', 'queued', 'on_block', 'closing_soon', 'sold', 'unsold', 'frozen', 'withdrawn')`,
    ),
    /*
     * A SOLD LOT HAS A WINNER AND A PRICE; AN UNSOLD ONE HAS NEITHER (0030).
     *
     * Both directions, because the machine is strict enough to allow both:
     * `sold` is terminal, its only exit is the compensating undo, and every
     * writer (sell, undo, recovery healing) moves status and the two sale
     * columns in ONE statement. Money surfaces read these three fields with
     * three different predicates and agree only while they agree with each
     * other.
     */
    check(
      "lots_sold_state_consistent",
      sql`case when ${table.status} = 'sold'
            then ${table.soldToPaddleId} is not null and ${table.soldPrice} is not null
            else ${table.soldToPaddleId} is null and ${table.soldPrice} is null
          end`,
    ),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    lotId: char("lot_id", { length: 26 })
      .notNull()
      .references(() => lots.id, { onDelete: "restrict" }),
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
    check("bids_status_check", sql`${table.status} in ('accepted', 'outbid', 'invalidated')`),
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
    personId: char("person_id", { length: 26 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    grantedBy: char("granted_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  // One ACTIVE grant per (auction, team, person); history survives revocation.
  (table) => [
    uniqueIndex("paddle_grants_active_uq")
      .on(table.auctionId, table.teamId, table.personId)
      .where(sql`revoked_at is null`),
    // INVARIANT 18 — an owner never owns two teams in one tournament (0042).
    // The index above stops a duplicate grant for the SAME team and says
    // nothing about a second one; this is the one that carries the invariant.
    // Deliberately NOT mirrored on `paddles`: DA-02 lets a conductor hold
    // several paddles to bid for owners who are not in the room.
    uniqueIndex("paddle_grants_auction_person_active_uq")
      .on(table.auctionId, table.personId)
      .where(sql`revoked_at is null`),
    index("paddle_grants_auction_idx").on(table.auctionId),
    index("paddle_grants_person_idx").on(table.personId),
  ],
);

// --- My plan (WR-1, M1). Purely additive: nothing above this line changes.
//
// A team owner's PRIVATE pre-auction plan: the players they mean to bid for,
// the most they mean to pay, and who they fall back to. It is NOT auction
// truth. The engine never reads it, the snapshot never carries it, and no rule
// derived from it can place or refuse a bid. It is compared against engine
// truth on the owner's own screen and nowhere else.
//
// WHY THE POLICY HAS A SECOND ARM. Every other auction table is org-scoped at
// RLS and participation-gated in the read model (`liveGate`). That is enough
// for data every participant may see. A plan is the one thing in this schema
// that one org member must never read about another: organizer, rival owner
// and plain member alike. So the two plan tables carry the org floor AND a
// participant arm in the policy itself (migration 0041): the same three
// sources `participantTeamIds` unions in the web tier, evaluated by Postgres
// against `app.person_id`. A read model that forgets to filter by team still
// receives nothing it should not, and `rls:verify` proves it per table.
//
// Keyed by REGISTRATION, not lot: a lot id dies with an abandoned auction and
// the registration survives into the recreated one. Money is integer paise.
// `max_bid` NULL means "no cap": the row is a target, not a price.

export const auctionTeamTargets = pgTable(
  "auction_team_targets",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 })
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    teamId: char("team_id", { length: 26 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    registrationId: char("registration_id", { length: 26 })
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    /** Integer paise. NULL = no cap set; the target is counted at base price. */
    maxBid: bigint("max_bid", { mode: "number" }),
    /** 1 must have · 2 high · 3 target (the default). */
    priority: smallint("priority").notNull().default(3),
    /** The player to turn to if this one is lost. Chains by following pointers. */
    fallbackRegistrationId: char("fallback_registration_id", { length: 26 }),
    createdBy: char("created_by", { length: 26 }).notNull(),
    updatedBy: char("updated_by", { length: 26 }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auction_team_targets_uq").on(table.auctionId, table.teamId, table.registrationId),
    index("auction_team_targets_team_idx").on(table.orgId, table.auctionId, table.teamId),
    // Named explicitly: drizzle's generated name for this one exceeds Postgres's
    // 63-character identifier limit and would be silently truncated (0041).
    foreignKey({
      name: "auction_team_targets_fallback_registrations_id_fk",
      columns: [table.fallbackRegistrationId],
      foreignColumns: [registrations.id],
    }).onDelete("set null"),
    check(
      "auction_team_targets_max_bid_check",
      sql`${table.maxBid} is null or ${table.maxBid} > 0`,
    ),
    check("auction_team_targets_priority_check", sql`${table.priority} in (1, 2, 3)`),
    check(
      "auction_team_targets_fallback_check",
      sql`${table.fallbackRegistrationId} is null or ${table.fallbackRegistrationId} <> ${table.registrationId}`,
    ),
  ],
);

/**
 * WHAT THE PLAN LOOKED LIKE, EVERY TIME IT CHANGED.
 *
 * Append-only. One row per add / update / remove, written in the SAME
 * transaction as the change, carrying the target's state AFTER it. This is
 * what lets a later "plan vs actual" say what the owner's ceiling WAS when the
 * hammer fell, rather than what it became afterwards. `at_seq` is the auction
 * snapshot version the owner was looking at when they edited, when the client
 * knew it: it places the edit on the auction's own timeline without touching
 * the auction's ledger.
 *
 * No foreign key to the target row: removing a target deletes that row and the
 * history must outlive it. Same participant-arm policy as the targets.
 */
export const auctionTeamTargetRevisions = pgTable(
  "auction_team_target_revisions",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    auctionId: char("auction_id", { length: 26 }).notNull(),
    teamId: char("team_id", { length: 26 }).notNull(),
    targetId: char("target_id", { length: 26 }).notNull(),
    kind: text("kind", { enum: ["added", "updated", "removed"] }).notNull(),
    registrationId: char("registration_id", { length: 26 }).notNull(),
    maxBid: bigint("max_bid", { mode: "number" }),
    priority: smallint("priority").notNull(),
    fallbackRegistrationId: char("fallback_registration_id", { length: 26 }),
    atSeq: integer("at_seq"),
    by: char("by", { length: 26 }).notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (table) => [
    index("auction_team_target_revisions_team_idx").on(table.orgId, table.auctionId, table.teamId),
    check(
      "auction_team_target_revisions_kind_check",
      sql`${table.kind} in ('added', 'updated', 'removed')`,
    ),
  ],
);

/**
 * WHICH FEATURES ARE SWITCHED OFF, AND WHERE.
 *
 * The first feature-flag table in the platform (docs/63 asked for one from day
 * one; nothing was built). Modelled on `org_messaging_settings`: a row per
 * (scope, feature), absence means the code default, and LAYERS CAN ONLY
 * SUBTRACT. A platform row, an org row and an auction row are ANDed together,
 * so any layer can turn a feature off and none can force it on over a higher
 * layer's no.
 *
 * `org_id` is the tenant floor for RLS, present on org and auction rows and
 * NULL on platform rows (which only the system pool reads). `auctions.config`
 * was deliberately NOT used: it locks at creation and a switch an organizer
 * flips mid-season does not belong in a locked contract.
 */
export const featureSettings = pgTable(
  "feature_settings",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }),
    scopeType: text("scope_type", { enum: ["platform", "org", "auction"] }).notNull(),
    scopeId: char("scope_id", { length: 26 }).notNull(),
    feature: text("feature").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedBy: char("updated_by", { length: 26 }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("feature_settings_uq").on(table.scopeType, table.scopeId, table.feature),
    index("feature_settings_org_idx").on(table.orgId),
    check(
      "feature_settings_scope_type_check",
      sql`${table.scopeType} in ('platform', 'org', 'auction')`,
    ),
    // Platform rows have no tenant; every other row must name one.
    check(
      "feature_settings_org_check",
      sql`(${table.scopeType} = 'platform') = (${table.orgId} is null)`,
    ),
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

// --- Financial Operations (IP-6, M-IP6-1). Purely additive: nothing above this
// line changes. Org-scoped; RLS read+write in migration 0014. finops_events is
// the APPEND-ONLY log of FIVE streams (profile · series · dispatch · export ·
// period) — the unique (stream_type, stream_id, seq) is the single-writer total
// order, the settlement discipline applied one platform up. Every finops table
// below it is a DISPOSABLE projection (rebuildable from events) or operational
// runner state (cursors, jobs — re-derivable, never truth). NO MONEY IS
// CALCULATED HERE: every amount is a quoted settlement fact (integer paise).

export const finopsEvents = pgTable(
  "finops_events",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    streamType: text("stream_type", {
      enum: ["profile", "series", "dispatch", "export", "period"],
    }).notNull(),
    // orgId (profile) · seriesId · dispatchId · exportId · periodId — all ULIDs.
    streamId: char("stream_id", { length: 26 }).notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    atMs: bigint("at_ms", { mode: "number" }).notNull(),
    actor: char("actor", { length: 26 }).notNull(),
    correlationId: char("correlation_id", { length: 26 }).notNull(),
    // ULID for human commands, a derived id for policy/scheduled ones — a re-run
    // returns the original ack instead of acting twice.
    commandId: text("command_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("finops_events_stream_seq_uq").on(table.streamType, table.streamId, table.seq),
    uniqueIndex("finops_events_command_uq").on(table.streamType, table.streamId, table.commandId),
    index("finops_events_stream_idx").on(table.streamType, table.streamId),
    index("finops_events_org_idx").on(table.orgId),
  ],
);

export const finopsProfiles = pgTable("finops_profiles", {
  // The row id IS the stream id (orgId): byte-stable across recovery.
  id: id(),
  orgId: char("org_id", { length: 26 }).notNull().unique(),
  legalName: text("legal_name").notNull(),
  posture: text("posture", { enum: ["none", "gst-registered"] }).notNull(),
  gstin: text("gstin"),
  autoReceipt: boolean("auto_receipt").notNull().default(false),
  version: integer("version").notNull(),
  declaredBy: char("declared_by", { length: 26 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const finopsSeries = pgTable(
  "finops_series",
  {
    // The row id IS the stream id (seriesId).
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    kind: text("kind", { enum: ["receipt", "tax-invoice", "correction"] }).notNull(),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    documentCount: integer("document_count").notNull().default(0),
    registerDigest: text("register_digest"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // ONE numbering lane per org · kind · fiscal year — forever, closed included.
  (table) => [
    uniqueIndex("finops_series_key_uq").on(table.orgId, table.kind, table.fy),
    index("finops_series_org_idx").on(table.orgId),
  ],
);

export const finopsDocuments = pgTable(
  "finops_documents",
  {
    // The row id IS the docId from the DocumentIssued event: byte-stable.
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    seriesId: char("series_id", { length: 26 }).notNull(),
    number: integer("number").notNull(),
    kind: text("kind", { enum: ["receipt", "tax-invoice", "correction"] }).notNull(),
    partyType: text("party_type").notNull(),
    partyId: text("party_id").notNull(),
    // Label SNAPSHOT at issue — readable after renames/erasure (doc 48/49).
    partyLabel: text("party_label").notNull(),
    // A QUOTED settlement amount (integer paise) — never computed here.
    amount: bigint("amount", { mode: "number" }).notNull(),
    corrects: char("corrects", { length: 26 }),
    sourceRef: text("source_ref"),
    profileSeq: integer("profile_seq").notNull(),
    watermark: jsonb("watermark").notNull(),
    contentDigest: text("content_digest").notNull(),
    issuedAtSeq: integer("issued_at_seq").notNull(),
    issuedBy: char("issued_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    // DENSE numbering is a schema fact, not just a reducer promise.
    uniqueIndex("finops_documents_series_number_uq").on(table.seriesId, table.number),
    // One settlement cause, one document per series.
    uniqueIndex("finops_documents_source_uq")
      .on(table.seriesId, table.sourceRef)
      .where(sql`source_ref is not null`),
    index("finops_documents_org_idx").on(table.orgId),
  ],
);

export const finopsDispatches = pgTable(
  "finops_dispatches",
  {
    // The row id IS the stream id (dispatchId).
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    status: text("status", { enum: ["requested", "sent", "confirmed", "failed"] })
      .notNull()
      .default("requested"),
    channel: text("channel", { enum: ["in-app", "email", "whatsapp", "org-webhook"] }).notNull(),
    recipientRef: text("recipient_ref").notNull(),
    templateId: text("template_id").notNull(),
    templateVersion: text("template_version").notNull(),
    subjectRef: text("subject_ref").notNull(),
    providerRef: text("provider_ref"),
    providerEventRef: text("provider_event_ref"),
    failureCode: text("failure_code"),
    requestedBy: char("requested_by", { length: 26 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("finops_dispatches_org_idx").on(table.orgId)],
);

export const finopsExports = pgTable(
  "finops_exports",
  {
    // The row id IS the stream id (exportId).
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    status: text("status", { enum: ["requested", "completed", "failed"] })
      .notNull()
      .default("requested"),
    kind: text("kind", {
      enum: ["tally-xml", "journal-csv", "gstr1-json", "audit-bundle", "archive-bundle"],
    }).notNull(),
    params: jsonb("params").notNull(),
    requestedBy: char("requested_by", { length: 26 }).notNull(),
    artifactRef: text("artifact_ref"),
    artifactDigest: text("artifact_digest"),
    rowCount: integer("row_count"),
    watermark: jsonb("watermark"),
    failureCode: text("failure_code"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("finops_exports_org_idx").on(table.orgId)],
);

export const finopsPeriods = pgTable(
  "finops_periods",
  {
    // The row id IS the stream id (periodId).
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    fy: text("fy").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    openedBy: char("opened_by", { length: 26 }).notNull(),
    openingWatermark: jsonb("opening_watermark").notNull(),
    lastWatermark: jsonb("last_watermark").notNull(),
    // The sealed evidence of the most recent close — a disposable projection of
    // the PeriodClosed event, rebuilt by recovery, verified against the log.
    evidence: jsonb("evidence"),
    closedAtSeq: integer("closed_at_seq"),
    openExceptions: integer("open_exceptions").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // ONE period per org · fiscal year, forever (reopen re-enters the same one).
  (table) => [
    uniqueIndex("finops_periods_org_fy_uq").on(table.orgId, table.fy),
    index("finops_periods_org_idx").on(table.orgId),
  ],
);

export const finopsPeriodDays = pgTable(
  "finops_period_days",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    periodId: char("period_id", { length: 26 }).notNull(),
    date: text("date").notNull(),
    attestor: char("attestor", { length: 26 }).notNull(),
    attestorKind: text("attestor_kind", { enum: ["system", "human"] }).notNull(),
    failures: integer("failures").notNull().default(0),
    checks: jsonb("checks").notNull(),
    watermark: jsonb("watermark").notNull(),
    attestedAtSeq: integer("attested_at_seq").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // Latest attestation per date (history lives in the log).
  (table) => [
    uniqueIndex("finops_period_days_date_uq").on(table.periodId, table.date),
    index("finops_period_days_org_idx").on(table.orgId),
  ],
);

export const finopsCursors = pgTable(
  "finops_cursors",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    // The consumed frontier over the READ-ONLY settlement streams. Operational
    // state, never truth: rewinding to zero is always safe (effects are
    // idempotent by derived command id).
    streamType: text("stream_type").notNull(),
    streamId: char("stream_id", { length: 26 }).notNull(),
    lastSeq: integer("last_seq").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("finops_cursors_stream_uq").on(table.orgId, table.streamType, table.streamId),
    index("finops_cursors_org_idx").on(table.orgId),
  ],
);

export const finopsJobs = pgTable(
  "finops_jobs",
  {
    id: id(),
    orgId: char("org_id", { length: 26 }).notNull(),
    kind: text("kind").notNull(),
    // The derived key: the same (kind, org, occasion) enqueues at most ONE job,
    // so a crashed or double-fired scheduler is idempotent by the schema.
    dedupeKey: text("dedupe_key").notNull(),
    state: text("state", { enum: ["queued", "leased", "done", "dead"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    notBeforeMs: bigint("not_before_ms", { mode: "number" }).notNull(),
    leasedUntilMs: bigint("leased_until_ms", { mode: "number" }),
    lastError: text("last_error"),
    payload: jsonb("payload").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("finops_jobs_dedupe_uq").on(table.orgId, table.dedupeKey),
    index("finops_jobs_claim_idx").on(table.state, table.notBeforeMs),
    index("finops_jobs_org_idx").on(table.orgId),
  ],
);

// Platform schedule slots — ZERO tenant data (slot names and epoch instants
// only), hence the one finops table without org_id/RLS. Documented in
// IP-6_ARCHITECTURE §20 posture: RLS guards tenant rows; this holds none.
export const finopsSchedules = pgTable("finops_schedules", {
  slot: text("slot", { enum: ["daily-ops", "year-end"] }).primaryKey(),
  nextDueMs: bigint("next_due_ms", { mode: "number" }).notNull(),
  lastFiredMs: bigint("last_fired_ms", { mode: "number" }),
});

// Home page "Stay updated" capture. Platform-level, ZERO tenant data (same
// posture as finops_schedules above) — no org_id, no RLS.
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: id(),
  email: text("email").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/**
 * SOMEBODY WANTS TO BE SHOWN (migration 0031).
 *
 * Platform-level, ZERO tenant data, no RLS — the same posture as
 * `newsletter_subscribers` above and for the same reason: the person filling
 * the form is a stranger with no session, no membership and no org to be scoped
 * to. The migration states the exception at length so it can never be mistaken
 * for one somebody forgot.
 *
 * The size band and the nullable date are deliberate. "How many teams?" asked
 * of somebody who has not run the tournament yet produces a guess typed as
 * fact, and a NOT NULL date makes them invent one.
 */
export const demoRequests = pgTable(
  "demo_requests",
  {
    id: id(),
    name: text("name").notNull(),
    /** E.164, via the same normaliser sign-in uses. */
    phone: text("phone").notNull(),
    /** Optional — needed only to receive the acknowledgement by mail. */
    email: text("email"),
    orgName: text("org_name").notNull(),
    tournamentSize: text("tournament_size", {
      enum: ["under-8", "8-16", "16-32", "over-32", "unsure"],
    }).notNull(),
    /**
     * Which sport they asked for (0045) — the SP-1 gate's only instrument.
     *
     * NULLABLE on purpose: a row written before the question existed has no
     * answer, and defaulting it would manufacture demand data in the one column
     * that exists to be counted. The app requires it going forward.
     *
     * This list is NOT the sport registry and must never be wired to it: the
     * registry names sports we can RUN, this records what somebody ASKED for,
     * so it has to offer sports we cannot run yet.
     */
    sport: text("sport", {
      enum: [
        "cricket",
        // Added when the pack shipped (0055). The registry and this list stay
        // separate on purpose — but a sport we CAN run must be sayable here, or
        // the organizer who runs it picks "cricket" and the demand signal for
        // the format they actually run is lost.
        "box_cricket",
        "football",
        "kabaddi",
        "volleyball",
        "badminton",
        "basketball",
        "hockey",
        // Renamed from "table-tennis" in 0057 — one identifier per sport, so
        // its demand is not split across two buckets.
        "table_tennis",
        "pickleball",
        "esports",
        // Added when the pack shipped (0059/0060), and the first lobby sport —
        // BGMI and Free Fire, the format with the largest player base of any
        // here and the one the form has never been able to ask about.
        "battle_royale",
        "other",
      ],
    }),
    auctionOn: date("auction_on"),
    preferredWindow: text("preferred_window", {
      enum: ["weekday-evening", "weekend-morning", "weekend-evening", "any"],
    }).notNull(),
    /** Their words: the most useful column for whoever answers. */
    note: text("note"),
    source: text("source", {
      enum: ["schedule-demo", "pricing", "landing", "help", "other"],
    }).notNull(),
    /** Throttling only; ages out with the row. */
    requestIp: text("request_ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Null contact = still open. Outcome and contact move together (CHECK). */
    contactedAt: ts("contacted_at"),
    contactedBy: char("contacted_by", { length: 26 }),
    outcome: text("outcome", {
      enum: ["scheduled", "showed", "no_show", "signed_up", "not_a_fit", "no_response"],
    }),
  },
  (table) => [
    index("demo_requests_created_idx").on(table.createdAt),
    index("demo_requests_phone_idx").on(table.phone, table.createdAt),
    index("demo_requests_ip_idx").on(table.requestIp, table.createdAt),
    index("demo_requests_sport_idx").on(table.sport, table.createdAt),
  ],
);

/**
 * WHAT IS ON OFFER (migration 0032) — recurring weekly windows in IST.
 *
 * Minutes past midnight rather than `time`, because the slot derivation does
 * arithmetic on them and every dialect of `time` in every driver is a different
 * shape. Weekday is 0 = Sunday, matching both `getDay()` and Postgres `DOW`.
 */
export const demoAvailability = pgTable(
  "demo_availability",
  {
    id: id(),
    weekday: smallint("weekday").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: char("created_by", { length: 26 }).notNull(),
  },
  (table) => [index("demo_availability_weekday_idx").on(table.weekday)],
);

/** Not this Thursday — a subtraction from the recurring pattern (0032). */
export const demoBlackouts = pgTable("demo_blackouts", {
  id: id(),
  blackoutOn: date("blackout_on").notNull().unique(),
  reason: text("reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: char("created_by", { length: 26 }).notNull(),
});

/**
 * THE BOOKING (migration 0032).
 *
 * Double-booking is refused by `demo_bookings_slot_uq`, a UNIQUE index over
 * live rows — not by a check-then-insert, which two people pressing at once
 * step straight through. A reschedule is a NEW row pointing at the one it
 * replaced, never an UPDATE of `slotStart`: "what time did we agree, and when
 * did that change?" is a question about the past.
 */
export const demoBookings = pgTable(
  "demo_bookings",
  {
    id: id(),
    demoRequestId: char("demo_request_id", { length: 26 }).notNull(),
    slotStart: ts("slot_start").notNull(),
    slotEnd: ts("slot_end").notNull(),
    /** SHA-256 of a base64url secret handed over once and never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    confirmedAt: ts("confirmed_at"),
    cancelledAt: ts("cancelled_at"),
    cancelledBy: text("cancelled_by", { enum: ["requester", "organizer"] }),
    rescheduledFrom: char("rescheduled_from", { length: 26 }),
    reminder24hSentAt: ts("reminder_24h_sent_at"),
    reminder1hSentAt: ts("reminder_1h_sent_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("demo_bookings_slot_idx").on(table.slotStart),
    index("demo_bookings_request_idx").on(table.demoRequestId),
  ],
);
