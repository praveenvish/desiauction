import { EmptyState, IconEye, type BadgeTone, type KitTone } from "@desiauction/ui";
import type { ReactNode } from "react";

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
  registration_open: "info",
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
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
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
  "auth.login.otp": "Signed in with a code",
  "auth.otp.requested": "Asked for a sign-in code",
  "profile.name.set": "Set their name",
  "org.created": "Created a club",
  "tournament.created": "Created a tournament",
  "competition.created": "Created a season",
  "registration.poster_generated": "Made a player poster",
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
