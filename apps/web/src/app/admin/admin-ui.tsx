import { IconEye, type BadgeTone, type KitTone } from "@desiauction/ui";
import type { ReactNode } from "react";

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
 * The empty-state recipe for administration's queues: centred, a duotone glyph
 * in a soft ring, a title, one line, and at most two doors. A queue at zero is
 * the GOOD state, so it should look settled rather than broken.
 */
export function AdminEmpty({
  icon,
  title,
  children,
  actions,
  testId,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="admin-empty" data-testid={testId}>
      <span className="admin-empty-ring" aria-hidden>
        {icon}
      </span>
      <p className="admin-empty-title">{title}</p>
      {children !== undefined ? <p className="admin-empty-body">{children}</p> : null}
      {actions !== undefined ? <div className="admin-empty-actions">{actions}</div> : null}
    </div>
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
const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function absoluteIst(at: Date): string {
  return `${IST.format(at)} IST`;
}

function distance(at: Date): string {
  const seconds = Math.round((Date.now() - at.getTime()) / 1000);
  // Future instants used to fall into the `< 60` branch below and print
  // "just now" — the Health page's "Next due 01 Apr 2027 · just now" beside a
  // NOT RUNNING runner read as "should be firing right now". Say "in 7mo".
  if (seconds < -30) {
    const ahead = -seconds;
    if (ahead < 3600) {
      return `in ${String(Math.max(1, Math.round(ahead / 60)))}m`;
    }
    if (ahead < 86400) {
      return `in ${String(Math.round(ahead / 3600))}h`;
    }
    const days = Math.round(ahead / 86400);
    return days < 60 ? `in ${String(days)}d` : `in ${String(Math.round(days / 30))}mo`;
  }
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${String(days)}d ago`;
  }
  return at.toISOString().slice(0, 10);
}

/**
 * An audit action code, as a sentence an operator reads — "tournament.created"
 * → "Tournament created", "finops.CertificationDerived" → "Finops · certification
 * derived". Presentation only: the code itself stays the record (the audit
 * explorer shows and filters by it) and rides along as the tooltip.
 */
export function humanAction(action: string): string {
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
  return n === 0 ? <span className="admin-zero">0</span> : <>{n.toLocaleString("en-IN")}</>;
}
