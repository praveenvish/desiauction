import type { KitTone } from "@desiauction/ui";

/**
 * WHAT EVERY HOME SHARES (RN-1 Phase 3).
 *
 * /home used to be one 1670-line file with `manages ?` woven through its
 * render, so a role's home was not a thing that could be designed, reviewed or
 * tested — it was a set of conditions inside somebody else's page. It is now a
 * router over one file per role, and this holds the handful of pieces more than
 * one of them needs. Nothing role-specific belongs here.
 */

/** Every home speaks the kit's colour words — one grammar across roles. */
export type Tone = KitTone;

export const REG_TONE: Record<string, Tone> = {
  submitted: "blue",
  approved: "green",
  waitlisted: "amber",
  rejected: "red",
  withdrawn: "neutral",
  draft: "neutral",
};

export function statusTone(status: string): Tone {
  switch (status) {
    // The console's one colour grammar — see STATUS_TONE in season-card.
    case "registration_open":
      return "blue";
    case "registration_closed":
      return "amber";
    default:
      return "neutral";
  }
}

/**
 * Compact label so the status column never truncates in a narrow panel.
 *
 * "Open"/"Closed" were shorter still, and wrong twice over: "Closed" told a
 * reader the SEASON had ended when only registration had (auction night is
 * next), and a settled season carried the same word as one mid-lifecycle.
 * These abbreviate the vocabulary /tournaments uses rather than invent one.
 */
export function statusLabel(status: string): string {
  switch (status) {
    case "registration_open":
      return "Reg open";
    case "registration_closed":
      return "Reg closed";
    case "setup":
      return "Setup";
    case "draft":
      return "Draft";
    default:
      return status.replace(/_/g, " ");
  }
}

/**
 * The one badge a season row shows. Whether the books are settled is the
 * settlement CASE's answer and outranks the competition status — the same
 * precedence the lifecycle rail below already applies.
 */
export function seasonBadge(row: {
  status: string;
  settlement: "settling" | "settled" | null;
  /**
   * The auction has been run. The competition status stops at
   * `registration_closed`, so without this a season with its squads picked
   * read "Reg closed" here while its overview said the auction was done.
   */
  auctionDone?: boolean;
}): {
  label: string;
  tone: Tone;
} {
  if (row.settlement === "settled") {
    return { label: "Settled", tone: "green" };
  }
  if (row.settlement === "settling") {
    return { label: "Settling", tone: "amber" };
  }
  if (row.auctionDone === true) {
    return { label: "Auction done", tone: "green" };
  }
  return { label: statusLabel(row.status), tone: statusTone(row.status) };
}

export function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
}

/**
 * Every date this product shows is Indian local time, wherever the server runs
 * (the organizer home keeps its own day/month formatters for the same reason).
 */
const IST_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  hourCycle: "h23",
});

export function greetingFor(now: Date, name: string | null): string {
  const { lead, title } = greetingParts(now, name);
  return lead !== null ? `${lead} ${title}` : title;
}

/**
 * The greeting split in two: `lead` ("Good morning,") is what a narrow phone
 * drops, so the person's own name is never the part that gets cut off.
 */
export function greetingParts(
  now: Date,
  name: string | null,
): { lead: string | null; title: string } {
  const hour = Number(IST_HOUR.format(now));
  const daypart = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name !== null && name.trim() !== ""
    ? { lead: `${daypart},`, title: name.trim() }
    : { lead: null, title: daypart };
}
