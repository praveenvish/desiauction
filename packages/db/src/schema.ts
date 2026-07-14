import {
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
