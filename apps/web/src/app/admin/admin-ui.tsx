import { initialsOf } from "@desiauction/core/initials";
import { EmptyState, IconEye, type BadgeTone, type KitTone } from "@desiauction/ui";
import { isNotificationKind, notificationOf } from "@desiauction/messaging/catalogue";
import type { ReactNode } from "react";

import { SHARED_EVENT_NAMES } from "../../lib/event-names";
import { formatDate, relativeAge } from "../../lib/format-date";
import { formatCount } from "../../lib/plural";

/** Ages come from the product's one date grammar (lib/format-date). */
export { relativeAge };

/**
 * PX-9 shared admin rendering. Presentation only — no reads, no rules. The
 * tone map is a LOOK-UP over statuses the domains already publish; it invents
 * no state and grades nothing. An unknown status renders neutral rather than
 * guessing, so a future domain state can never be silently coloured "fine".
 */

const TONES: Record<string, BadgeTone> = {
  // Auction (IP-4)
  scheduled: "neutral",
  live: "live",
  paused: "warning",
  completed: "success",
  reconciled: "success",
  abandoned: "danger",
  // Settlement (IP-5)
  opened: "info",
  verified: "info",
  discrepant: "danger",
  settling: "warning",
  settled: "success",
  closed: "success",
  voided: "neutral",
  // Competition (IP-3)
  draft: "neutral",
  setup: "neutral",
  registration_open: "success",
  registration_closed: "neutral",
};

export function statusTone(status: string): BadgeTone {
  return TONES[status] ?? "neutral";
}

/** The same look-up for the console kit's `Pill` tones. Unknown → neutral. */
const PILL_TONES: Record<BadgeTone, KitTone> = {
  neutral: "neutral",
  live: "green",
  warning: "amber",
  success: "green",
  danger: "red",
  info: "blue",
};

export function statusPillTone(status: string): KitTone {
  return PILL_TONES[statusTone(status)];
}

/**
 * Administration says what it is, at the top of every read-only surface. Not
 * decoration: an operator arriving at a platform-wide console during an
 * incident needs to know, before they click anything, that nothing here can act.
 *
 * It used to be a three-line banner repeated above every page (~80px on a
 * laptop, ~150px on a phone, the same paragraph each time). The FACT stays
 * visible — a pill beside the page's lede — and the sentence is one tap away.
 * A <details>, so it opens without script.
 */
export function ReadOnlyNotice() {
  return (
    <details className="admin-ro" data-testid="admin-readonly">
      <summary className="admin-ro-pill">
        <IconEye size={16} />
        Read-only
        <span className="admin-sr-only">: what that means</span>
      </summary>
      <p className="admin-ro-panel">
        Administration observes the platform; every operational fix happens in the console that owns
        it, under that console&rsquo;s own permissions — which a platform grant alone does not
        confer. Page views here are recorded in the audit log.
      </p>
    </details>
  );
}

/**
 * The page's one line under the shell's title: a short lede on the left, the
 * page's doors and the read-only pill on the right. A <div>, not a <header> —
 * the shell owns the page's one banner landmark.
 */
export function AdminPageHead({
  children,
  actions,
  readOnly = false,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  readOnly?: boolean;
}) {
  return (
    <div className="admin-pagehead">
      {children !== undefined ? <div className="admin-lede">{children}</div> : null}
      {actions !== undefined || readOnly ? (
        <div className="admin-pagehead-end">
          {actions}
          {readOnly ? <ReadOnlyNotice /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Two initials for a person's monogram; "?" for the unnamed. */
export function monogram(name: string | null): string {
  return initialsOf(name ?? "") || "?";
}

/**
 * Administration's queues at zero — the product's one EmptyState (round 3B),
 * kept as a name so the queue pages read the same. A queue at zero is the GOOD
 * state, so it looks settled rather than broken.
 */
export function AdminEmpty({
  icon,
  title,
  children,
  actions,
  testId,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      headingLevel={2}
      {...(children !== undefined ? { description: children } : {})}
      {...(actions !== undefined ? { action: actions } : {})}
      {...(testId !== undefined ? { testId } : {})}
    />
  );
}

/**
 * The absolute time, and the distance from now.
 *
 * It used to be `title={iso}` and nothing else: the absolute timestamp was
 * reachable by hovering a mouse and by no other means — not by keyboard, not
 * announced to a screen reader, and invisible on every touch device. On a
 * forensic surface the absolute time is the PRIMARY datum, and it also named no
 * timezone anywhere, so "14:20" was 14:20 in a zone the reader had to guess.
 *
 * So: the accessible name always carries the full, zone-named timestamp, and
 * `absolute` renders it visibly for the surfaces (audit, schedules) where the
 * exact moment is the point rather than the colour.
 *
 * Rendered on the server only — these are server components, so `Date.now()`
 * here cannot disagree with a client render.
 */
export function RelativeTime({ at, absolute = false }: { at: Date; absolute?: boolean }) {
  const iso = at.toISOString();
  const exact = absoluteIst(at);
  return (
    <time
      // The relative form is two words and stays on one line; the absolute form
      // is "02 Aug 2026, 15:23 IST · 3d ago", which at 320px must be allowed to
      // wrap or it pushes the card open (measured: 409px of a 320px viewport).
      className={absolute ? "admin-when admin-when-wide" : "admin-when"}
      dateTime={iso}
      title={exact}
    >
      {/* The exact moment is what assistive technology is told, always. Not via
          `aria-label`: `<time>` carries no ARIA role, so labelling it would be
          `aria-prohibited-attr` — a real axe violation traded for a fix. */}
      <span className="admin-sr-only">{exact}</span>
      {absolute ? (
        <span aria-hidden>
          {exact} · {distance(at)}
        </span>
      ) : (
        <span aria-hidden>{distance(at)}</span>
      )}
    </time>
  );
}

/**
 * IST, named. The product is Indian and every operator reading this console
 * works in one timezone; the stored value is UTC, and printing it unlabelled
 * was a five-and-a-half-hour lie by omission.
 */
const IST_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2 Aug 2026, 15:23 IST" — the date in the product's one form, a 24h clock. */
export function absoluteIst(at: Date): string {
  return `${formatDate(at)}, ${IST_CLOCK.format(at)} IST`;
}

function distance(at: Date): string {
  return relativeAge(at.getTime(), Date.now());
}

/**
 * An audit action code, as a sentence an operator reads — "tournament.created"
 * → "Tournament created", "finops.CertificationDerived" → "Finops · certification
 * derived". Presentation only: the code itself stays the record (the audit
 * explorer shows and filters by it) and rides along as the tooltip.
 */
const ACTION_WORDS: Readonly<Record<string, string>> = {
  ...SHARED_EVENT_NAMES,
  "auth.login.otp": "Signed in with a code",
  "auth.otp.requested": "Asked for a sign-in code",
  "profile.name.set": "Set their name",
  "org.created": "Created a club",
  "tournament.created": "Created a tournament",
  "competition.created": "Created a season",
  "registration.imported": "Imported players",
  "registration.approved": "Approved a registration",
  "registration.approve": "Approved a registration",
  "registration.notified": "Told a player their result",
  "registration.marks_set": "Marked a player icon or captain",
  "registration.submitted": "Registered for a season",
  "registration.updated": "Updated a registration",
  "registration.details_edited": "Edited a player's details",
  "registration.exported": "Exported the player list",
  "registration.added": "Added a player",
  "admin.accessed": "Opened an admin page",
  "finops.CertificationDerived": "Finance books checked",
  "competition.status_changed": "Moved a season to its next stage",
  "competition.visibility_changed": "Changed who can see a season",
  "team.created": "Created a team",
  "auth.phone.changed": "Changed their phone number",
  "auth.signup.email": "Signed up with email",
  "auth.logout": "Signed out",
  "grant.issued": "Gave someone access",
  "grant.revoked": "Took away someone's access",
  "invite.created": "Sent an invitation",
  "invite.accepted": "Accepted an invitation",
  "fixture.schedule": "Scheduled a match",
  "fixture.publish": "Published the fixtures",
  "fixture.generated": "Generated the fixtures",
  "ground.created": "Added a ground",
  "venue.created": "Added a venue",
  "profile.player.updated": "Updated their player profile",
  "auction.owner_join": "A team owner joined the auction",
  "auction.sold": "Sold a player",
  "auction.unsold": "A player went unsold",
  "auction.feature_toggled": "Switched an auction feature",
  "auction.AuctionCreated": "Created an auction",
  "auction.AuctionOpened": "Opened the auction",
  "auction.AuctionClosed": "Closed the auction",
  "auction.LotPrepared": "Prepared a lot",
  "auction.LotQueued": "Queued a lot",
  "auction.LotOpened": "Put a lot on the block",
  "auction.LotClosingSoon": "Lot closing soon",
  "auction.LotSold": "Lot sold",
  "auction.LotUnsold": "Lot unsold",
  "auction.LotRequeued": "Sent a lot back into the queue",
  "auction.BidAccepted": "Bid accepted",
  "auction.TimerExtended": "Timer extended",
  "auction.PaddleIssued": "Issued a paddle",
  "auction.PaddleGranted": "Granted a paddle",
  "auction.OwnerInvited": "Invited a team owner",
  "auction.OwnerAccepted": "Owner accepted the invitation",
  "settlement.JournalPosted": "Posted to the settlement journal",
  "settlement.PaymentCaptured": "Payment received",
  "settlement.PaymentInitiated": "Payment started",
  "settlement.CaseOpened": "Opened a settlement case",
  "settlement.ObligationDischarged": "A payment obligation was met",
};

export function humanAction(action: string): string {
  const known = ACTION_WORDS[action];
  if (known !== undefined) return known;
  const words = action
    .split(/[._:]/)
    .filter((part) => part !== "")
    .map((part) =>
      part
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/-/g, " ")
        .toLowerCase(),
    );
  if (words.length === 0) return action;
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * A message shape's key as words: "registration.approved@2" reads
 * "Registration approved · v2". The key stays the row's hover and test id.
 */
export function messageKeyLabel(key: string): string {
  const [base = key, version] = key.split("@");
  // The catalogue's own name first: the key `registration.rejected` read
  // "Registration rejected" here while Notifications, Analytics and Templates
  // (which read the catalogue) called the same message "Registration declined".
  const named = isNotificationKind(base) ? notificationOf(base).label : null;
  const words = base
    .split(/[._:]/)
    .filter((part) => part !== "")
    .map((part) =>
      part
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]/g, " ")
        .toLowerCase(),
    )
    .join(" ");
  const sentence = named ?? (words === "" ? base : words.charAt(0).toUpperCase() + words.slice(1));
  return version !== undefined && version !== "" ? `${sentence} · v${version}` : sentence;
}

/**
 * A KPI tile's figure. A zero is the calm answer and reads muted; every other
 * figure is grouped the Indian way ("1,06,700" is what an operator here reads).
 */
export function KpiValue({ n }: { n: number }) {
  return n === 0 ? <span className="admin-zero">0</span> : <>{formatCount(n)}</>;
}

/**
 * A count in a table cell. A zero is drawn as a quiet dash (and announced as
 * "0"), so a column of mostly-nothing stops shouting and the few real figures
 * stand out — the Stripe/Linear table rule.
 */
export function TableCount({ n }: { n: number }) {
  if (n === 0) {
    return (
      <span className="admin-zero" title="0">
        <span aria-hidden>—</span>
        <span className="admin-sr-only">0</span>
      </span>
    );
  }
  return <>{formatCount(n)}</>;
}

/**
 * Consecutive rows that say the same thing, folded: ten
 * "registration.poster_generated by Sanjay Patil" become one row marked ×10,
 * dated by the newest. Order is kept; nothing is dropped from the count.
 */
export function foldRuns<T>(
  rows: readonly T[],
  same: (a: T, b: T) => boolean,
): { row: T; count: number }[] {
  const out: { row: T; count: number }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last !== undefined && same(last.row, row)) {
      last.count += 1;
    } else {
      out.push({ row, count: 1 });
    }
  }
  return out;
}

/**
 * A sign-in is two audit rows — "Asked for a sign-in code", then "Signed in
 * with a code" — and on a person's activity list they were half the rows. The
 * request folds into the sign-in right after it (rows arrive newest first);
 * a request that led to no sign-in stays, since that is worth seeing.
 */
export function foldSignInRequests<T extends { action: string }>(rows: readonly T[]): T[] {
  return rows.filter(
    (row, index) =>
      !(row.action === "auth.otp.requested" && rows[index - 1]?.action === "auth.login.otp"),
  );
}

/** How many rows of a change log show before "Show all". */
export const RECENT_SHOWN = 5;

/**
 * A change log: the newest few, the rest one press away. Twenty rows of mostly
 * on→off→on churn doubled three admin pages on a phone (Notifications 19k px);
 * the newest change — the one an operator came to revert — is always shown.
 */
export function RecentFold<T>({
  items,
  className,
  children,
  keep = RECENT_SHOWN,
}: {
  items: readonly T[];
  className: string;
  children: (item: T) => ReactNode;
  keep?: number;
}) {
  return (
    <>
      <ul className={className}>{items.slice(0, keep).map(children)}</ul>
      {items.length > keep ? (
        <details className="admin-more">
          <summary>Show all {String(items.length)}</summary>
          <ul className={className}>{items.slice(keep).map(children)}</ul>
        </details>
      ) : null}
    </>
  );
}

const CAPABILITY_WORDS: Readonly<Record<string, string>> = {
  "org:owner": "Club owner",
  "org:staff": "Club staff",
  "org:superadmin": "Club superadmin",
  "auction:conductor": "Auctioneer",
  "settlement:controller": "Settlement controller",
  "finops:controller": "Finance controller",
  "platform:admin": "Platform admin",
};

/**
 * A capability set in words. The pages printed the key itself (`org:owner`)
 * as the grant's name; the key stays on the hover for anyone who needs it.
 */
export function capabilityLabel(set: string): string {
  const known = CAPABILITY_WORDS[set];
  if (known !== undefined) {
    return known;
  }
  const words = set
    .split(/[:_-]/)
    .filter((part) => part !== "")
    .join(" ")
    .toLowerCase();
  return words === "" ? set : words.charAt(0).toUpperCase() + words.slice(1);
}

/** A grant's scope type ("org", "platform") as a reader says it. */
export function scopeTypeLabel(scopeType: string): string {
  switch (scopeType) {
    case "org":
      return "Club";
    case "platform":
      return "Platform";
    case "competition":
      return "Season";
    case "auction":
      return "Auction";
    default:
      return scopeType.charAt(0).toUpperCase() + scopeType.slice(1);
  }
}
