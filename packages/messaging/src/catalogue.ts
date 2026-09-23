/**
 * THE NOTIFICATION CATALOGUE — every message this product sends, in one place.
 *
 * Before this file the answer to "what do we send, and who can stop it?" was
 * spread across a dozen modules: the outbox's `kind` strings, the DLT template
 * keys, the WhatsApp template keys, the inbox's action keys, the finops
 * template ids and eighteen direct `mailer.send` calls that each decided for
 * themselves whether a switch applied. Two of those answers were wrong in ways
 * a person could see: switching off "Receipts and money" on /account stopped
 * nothing, because the receipt path never asked.
 *
 * Every sender now names its entry here by key (a typed union, so a typo is a
 * compile error), and every send passes `notificationGate` (gate.ts), which
 * reads the entry to decide which switches apply. The /account and /org switch
 * lists are rendered FROM this file, so a switch can only exist for a message
 * the gate will actually consult it for — the org screen used to show a
 * "Feedback requests" switch that no sender ever read.
 *
 * Pure data and pure functions. The Phase 1 admin grid reads the same table.
 */

export type NotificationChannel = "email" | "whatsapp" | "sms" | "in_app";

/**
 * What kind of message this is — which decides, before anything else, who may
 * switch it off (`CATEGORY_RULES` below).
 *
 *   · login         — a code the person asked for seconds ago. Nothing stops it.
 *   · security      — "your number/email was changed". Never the person's or a
 *                     club's to silence; a platform admin may, with a reason.
 *   · transactional — the consequence of something the person or their club did.
 *   · operational   — our own staff notices (a demo lead, a problem report).
 *   · promotional   — needs a recorded opt-in. None exist yet.
 */
export type NotificationCategory =
  "login" | "security" | "transactional" | "operational" | "promotional";

export type NotificationAudience =
  "player" | "owner" | "organizer" | "account" | "stranger" | "staff";

/**
 * The switch a message hangs off. The first four are the person's switches on
 * /account (and the `scope` a STOP can be narrowed to); the rest name a family
 * for suppression scopes and the admin grid, and have no personal switch.
 */
export type NotificationTopic =
  | "registration"
  | "auction"
  | "money"
  | "feedback"
  | "login"
  | "security"
  | "demo"
  | "support"
  | "staff";

export interface NotificationEntry {
  readonly key: string;
  /** Short, for the admin grid. */
  readonly label: string;
  /** One line: when it goes, and to whom. */
  readonly description: string;
  readonly audience: NotificationAudience;
  readonly category: NotificationCategory;
  readonly topic: NotificationTopic;
  readonly channels: readonly NotificationChannel[];
  /**
   * The audit-log action the inbox row is written under, when it differs from
   * the key. `lineup.announced` is queued under one name and written to the
   * ledger under another (`fixture.lineup_announced`), and both are this entry.
   */
  readonly inboxKeys?: readonly string[];
  /** Overrides of the category's defaults — used sparingly, each one explained. */
  readonly personControllable?: boolean;
  readonly orgControllable?: boolean;
}

/**
 * THE FOUNDER'S RULES (2026-09-23), encoded once.
 *
 * `adminNeedsReason` is Phase 0 data only: Phase 1's admin screen must demand a
 * written reason (and show a warning) before a security alert can be switched
 * off. `adminDisableable: false` is a lock — not even a platform admin.
 */
const CATEGORY_RULES: Readonly<
  Record<
    NotificationCategory,
    {
      readonly personControllable: boolean;
      readonly orgControllable: boolean;
      readonly adminDisableable: boolean;
      readonly adminNeedsReason: boolean;
    }
  >
> = {
  login: {
    personControllable: false,
    orgControllable: false,
    adminDisableable: false,
    adminNeedsReason: false,
  },
  security: {
    personControllable: false,
    orgControllable: false,
    adminDisableable: true,
    adminNeedsReason: true,
  },
  transactional: {
    personControllable: true,
    orgControllable: true,
    adminDisableable: true,
    adminNeedsReason: false,
  },
  operational: {
    personControllable: false,
    orgControllable: false,
    adminDisableable: true,
    adminNeedsReason: false,
  },
  promotional: {
    personControllable: true,
    orgControllable: true,
    adminDisableable: true,
    adminNeedsReason: false,
  },
};

const TEXT: readonly NotificationChannel[] = ["sms", "whatsapp"];

/**
 * Every notification. Order is the admin grid's order: login, security, the
 * player's season, money, feedback, then the strangers and our own staff.
 */
const ENTRIES = [
  // --- Login: locked ---------------------------------------------------------
  {
    key: "auth.email_code",
    label: "Sign-in code by email",
    description:
      "The six-digit code for signing in, signing up or confirming a new address — only when asked for.",
    audience: "account",
    category: "login",
    topic: "login",
    channels: ["email"],
  },
  {
    key: "auth.phone_code",
    label: "Sign-in code by text",
    description: "The six-digit sign-in code by SMS or WhatsApp — only when asked for.",
    audience: "account",
    category: "login",
    topic: "login",
    channels: TEXT,
  },
  // --- Security: admin-only, with a reason -----------------------------------
  {
    key: "security.phone_changed",
    label: "Mobile number changed",
    description:
      "Warns the number being given up, and the verified email, that the account's mobile number moved.",
    audience: "account",
    category: "security",
    topic: "security",
    channels: ["email", ...TEXT],
  },
  {
    key: "security.email_changed",
    label: "Sign-in email changed",
    description:
      "Warns the address that just lost the account, and the phone on WhatsApp, that the sign-in email moved.",
    audience: "account",
    category: "security",
    topic: "security",
    channels: ["email", "whatsapp"],
  },
  // --- The player's season ----------------------------------------------------
  {
    key: "registration.approved",
    label: "Registration approved",
    description: "An organizer approved the player into the pool.",
    audience: "player",
    category: "transactional",
    topic: "registration",
    channels: ["email", ...TEXT, "in_app"],
  },
  {
    key: "registration.waitlisted",
    label: "Registration waitlisted",
    description: "An organizer put the player on the waitlist.",
    audience: "player",
    category: "transactional",
    topic: "registration",
    channels: ["email", ...TEXT, "in_app"],
  },
  {
    key: "registration.rejected",
    label: "Registration declined",
    description: "An organizer declined the registration, with the reason.",
    audience: "player",
    category: "transactional",
    topic: "registration",
    channels: ["email", ...TEXT, "in_app"],
  },
  {
    key: "registration.withdrawn",
    label: "Registration withdrawn",
    description: "The registration was withdrawn.",
    audience: "player",
    category: "transactional",
    topic: "registration",
    channels: ["email", ...TEXT],
  },
  {
    key: "registration.restored",
    label: "Registration restored",
    description: "A withdrawn registration was put back.",
    audience: "player",
    category: "transactional",
    topic: "registration",
    channels: ["email", ...TEXT],
  },
  {
    key: "auction.sold",
    label: "Sold at auction",
    description: "When the auction completes: which team bought the player, and for how much.",
    audience: "player",
    category: "transactional",
    topic: "auction",
    channels: ["email", ...TEXT, "in_app"],
  },
  {
    key: "auction.unsold",
    label: "Unsold at auction",
    description: "When the auction completes without a bid for the player. Never by text.",
    audience: "player",
    category: "transactional",
    topic: "auction",
    channels: ["email", "in_app"],
  },
  {
    key: "auction.owner_summary",
    label: "Owner's auction summary",
    description: "Each team owner's squad, spend and purse left, when the auction completes.",
    audience: "owner",
    category: "transactional",
    topic: "auction",
    channels: ["email"],
  },
  {
    key: "team.appointed",
    label: "Named to a team role",
    description: "Captain, vice-captain, icon or retained — when the organizer announces it.",
    audience: "player",
    category: "transactional",
    topic: "auction",
    channels: ["email", ...TEXT, "in_app"],
  },
  {
    key: "team.squad_sheet",
    label: "Squad sheet",
    description: "The player's final squad, coach and first match.",
    audience: "player",
    category: "transactional",
    topic: "auction",
    channels: ["email", "in_app"],
  },
  {
    key: "lineup.announced",
    label: "Named in a lineup",
    description: "The player is in the team's lineup for a match.",
    audience: "player",
    category: "transactional",
    topic: "auction",
    channels: ["email", ...TEXT, "in_app"],
    inboxKeys: ["fixture.lineup_announced"],
  },
  // --- Money --------------------------------------------------------------
  {
    key: "finance.document.issued",
    label: "Receipt or invoice issued",
    description:
      "A club's finance desk issued the team a receipt, invoice or correction (the certified finops dispatch).",
    audience: "owner",
    category: "transactional",
    topic: "money",
    channels: ["email", "in_app"],
  },
  // --- Feedback -----------------------------------------------------------
  {
    key: "review.platform_ask",
    label: "Review request (DesiAuction)",
    description: "We ask an organizer, owner or player how DesiAuction worked for them.",
    audience: "account",
    category: "transactional",
    topic: "feedback",
    channels: ["email"],
    // Sent by the platform, not on a club's behalf — no club switch reaches it.
    orgControllable: false,
  },
  {
    key: "review.season_ask",
    label: "Review request (a season)",
    description: "We ask a season's players and owners how it went, for the season's page.",
    audience: "player",
    category: "transactional",
    topic: "feedback",
    channels: ["email"],
    /*
     * Not the club's switch, in Phase 0. The sender reads on the bare app pool,
     * where the club's FORCE-RLS settings are invisible, so offering the switch
     * would be offering one that silently does nothing (consent.ts on `db`
     * being part of the contract). The org screen showed exactly that switch.
     */
    orgControllable: false,
  },
  // --- Strangers: a demo requester, a person reporting a problem -------------
  {
    key: "demo.request_received",
    label: "Demo request received",
    description: "Tells the person who asked for a demo that we have it.",
    audience: "stranger",
    category: "transactional",
    topic: "demo",
    channels: ["email"],
    // A stranger has no account, so no switch; a bounce or a complaint (the
    // suppression list) is what stops these.
    personControllable: false,
    orgControllable: false,
  },
  {
    key: "demo.booking_confirmed",
    label: "Demo booked",
    description: "The booked demo slot, with a calendar invite and the manage link.",
    audience: "stranger",
    category: "transactional",
    topic: "demo",
    channels: ["email"],
    personControllable: false,
    orgControllable: false,
  },
  {
    key: "demo.booking_cancelled",
    label: "Demo cancelled",
    description: "The demo was cancelled, with a cancelling calendar invite.",
    audience: "stranger",
    category: "transactional",
    topic: "demo",
    channels: ["email"],
    personControllable: false,
    orgControllable: false,
  },
  {
    key: "demo.booking_reminder",
    label: "Demo reminder",
    description: "A day, then an hour, before the booked demo.",
    audience: "stranger",
    category: "transactional",
    topic: "demo",
    channels: ["email"],
    personControllable: false,
    orgControllable: false,
  },
  {
    key: "support.report_received",
    label: "Problem report received",
    description:
      "A receipt to a signed-in person's own verified address after they report a problem.",
    audience: "account",
    category: "transactional",
    topic: "support",
    channels: ["email"],
    // A receipt for the thing they did a moment ago; there is no topic to
    // switch and no club involved.
    personControllable: false,
    orgControllable: false,
  },
  // --- Our own staff ---------------------------------------------------------
  {
    key: "staff.demo_request",
    label: "New demo request (to us)",
    description: "The founder's notice of a new demo lead, to the support mailbox.",
    audience: "staff",
    category: "operational",
    topic: "staff",
    channels: ["email"],
  },
  {
    key: "staff.problem_report",
    label: "New problem report (to us)",
    description: "A reported problem, with its screenshot, to the support mailbox.",
    audience: "staff",
    category: "operational",
    topic: "staff",
    channels: ["email"],
  },
  {
    key: "staff.review_arrived",
    label: "New review (to us)",
    description: "A first-time review, to the support mailbox for moderation.",
    audience: "staff",
    category: "operational",
    topic: "staff",
    channels: ["email"],
  },
] as const satisfies readonly NotificationEntry[];

/** Every key a sender may name. A typo is a compile error. */
export type NotificationKind = (typeof ENTRIES)[number]["key"];

/** One entry with its category's rules resolved — what the gate and the UIs read. */
export interface ResolvedNotification {
  readonly key: NotificationKind;
  readonly label: string;
  readonly description: string;
  readonly audience: NotificationAudience;
  readonly category: NotificationCategory;
  readonly topic: NotificationTopic;
  readonly channels: readonly NotificationChannel[];
  /** The audit-log actions its inbox row is written under (the key, or its aliases). */
  readonly inboxKeys: readonly string[];
  readonly personControllable: boolean;
  readonly orgControllable: boolean;
  readonly adminDisableable: boolean;
  readonly adminNeedsReason: boolean;
}

function resolve(entry: (typeof ENTRIES)[number]): ResolvedNotification {
  const rules = CATEGORY_RULES[entry.category];
  const own: NotificationEntry = entry;
  return {
    key: entry.key,
    label: entry.label,
    description: entry.description,
    audience: entry.audience,
    category: entry.category,
    topic: entry.topic,
    channels: entry.channels,
    inboxKeys: own.channels.includes("in_app") ? (own.inboxKeys ?? [entry.key]) : [],
    /*
     * An override may only NARROW a category's rules. A login code or a
     * security alert that some entry marked switchable would be the exact
     * mistake these rules exist to prevent, so `&&` rather than `??`.
     */
    personControllable: rules.personControllable && (own.personControllable ?? true),
    orgControllable: rules.orgControllable && (own.orgControllable ?? true),
    adminDisableable: rules.adminDisableable,
    adminNeedsReason: rules.adminNeedsReason,
  };
}

export const NOTIFICATIONS: readonly ResolvedNotification[] = ENTRIES.map(resolve);

const BY_KEY: ReadonlyMap<string, ResolvedNotification> = new Map(
  NOTIFICATIONS.map((entry) => [entry.key, entry]),
);

export function isNotificationKind(key: string): key is NotificationKind {
  return BY_KEY.has(key);
}

export function notificationOf(kind: NotificationKind): ResolvedNotification {
  // Present by construction: `NotificationKind` is derived from ENTRIES.
  return BY_KEY.get(kind) as ResolvedNotification;
}

/**
 * The switch topics a PERSON sees on /account, in order, with their wording.
 * The wording lives here, beside the kinds it governs, rather than in the
 * consent module — `personTopics()` only lists a topic some kind actually
 * obeys.
 */
const TOPIC_COPY: Readonly<Partial<Record<NotificationTopic, { label: string; detail: string }>>> =
  {
    registration: {
      label: "Registration decisions",
      detail: "When an organizer approves, waitlists or declines you.",
    },
    auction: {
      label: "Auction updates",
      detail: "When an auction you are in is about to start, and how it went.",
    },
    money: {
      label: "Receipts and money",
      detail: "When a club issues you a receipt or records a payment.",
    },
    feedback: {
      label: "Feedback requests",
      detail: "When we ask how a season or DesiAuction worked for you.",
    },
  };

export interface SwitchTopic {
  readonly topic: NotificationTopic;
  readonly label: string;
  readonly detail: string;
}

function topicsWhere(test: (entry: ResolvedNotification) => boolean): SwitchTopic[] {
  const seen: SwitchTopic[] = [];
  for (const entry of NOTIFICATIONS) {
    const copy = TOPIC_COPY[entry.topic];
    if (!test(entry) || copy === undefined || seen.some((s) => s.topic === entry.topic)) {
      continue;
    }
    seen.push({ topic: entry.topic, ...copy });
  }
  return seen;
}

/** The person's switches — every topic at least one person-controllable kind obeys. */
export function personTopics(): SwitchTopic[] {
  return topicsWhere((entry) => entry.personControllable);
}

/** The club's switches — every topic at least one club-controllable kind obeys. */
export function orgTopics(): SwitchTopic[] {
  return topicsWhere((entry) => entry.orgControllable);
}

/**
 * The preference/suppression ROW a channel is recorded under.
 *
 * `notification_preferences`, `org_messaging_settings` and `suppressions` know
 * `sms`, `email` and `in-app` (0044's CHECK constraints). WhatsApp is not a row
 * of its own: it is the TEXT row, because the outbox decides WhatsApp-or-SMS
 * only after the text as a whole has been allowed, and because "stop texting
 * me about auctions" means both apps. WhatsApp's own opt-in is a consent record
 * checked in the text route (whatsapp.ts), not a switch here.
 */
export function rowChannelOf(channel: NotificationChannel): "sms" | "email" | "in-app" {
  if (channel === "in_app") return "in-app";
  if (channel === "whatsapp") return "sms";
  return channel;
}

/** The channels a club's switch writes, and the gate reads — one per ROW. */
export const ORG_SWITCH_CHANNELS = ["sms", "email"] as const;

/** The channels the /account switch writes. In-app is read (inbox), not yet written by a switch. */
export const PERSON_SWITCH_CHANNELS = ["sms", "email"] as const;
