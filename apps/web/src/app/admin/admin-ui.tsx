import type { BadgeTone } from "@desiauction/ui";

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

/**
 * Administration says what it is, at the top of every surface. Not decoration:
 * an operator arriving at a platform-wide console during an incident needs to
 * know, before they click anything, that nothing here can act.
 */
export function ReadOnlyNotice() {
  return (
    <p className="admin-readonly" data-testid="admin-readonly">
      <span aria-hidden>👁</span>
      <span>
        Read-only. Administration observes the platform; every operational fix happens in the
        console that owns it, under that console&rsquo;s own permissions — which a platform grant
        alone does not confer. Page views here are recorded in the audit log.
      </span>
    </p>
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
