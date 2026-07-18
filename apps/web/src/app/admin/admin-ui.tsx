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
        console that owns it, under that console&rsquo;s own permissions.
      </span>
    </p>
  );
}

/** Absolute time in the title, human distance in the text — one element, both truths. */
export function RelativeTime({ at }: { at: Date }) {
  const iso = at.toISOString();
  return (
    <time className="admin-when" dateTime={iso} title={iso}>
      {distance(at)}
    </time>
  );
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
