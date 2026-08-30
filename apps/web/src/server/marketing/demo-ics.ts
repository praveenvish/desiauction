/**
 * A CALENDAR INVITE, BUILT BY HAND.
 *
 * RFC 5545 for one VEVENT is a few dozen lines of string building, and this
 * repository has stayed at twelve dependencies by asking, every time, whether
 * the library is doing something we could not. `ics`, `ical-generator` and the
 * rest exist to model recurrence, timezones, attendees and alarms across the
 * whole spec. This needs one non-recurring event in UTC. The same argument
 * `email-adapter.ts` makes about SMTP libraries applies unchanged.
 *
 * What that decision buys us is that the awkward parts are visible rather than
 * inherited: line folding at 75 octets, CRLF endings, escaping, and a UID that
 * stays stable across a reschedule so a calendar UPDATES the entry instead of
 * accumulating a second one. Those are the four things clients actually care
 * about, and all four are below.
 */

const CRLF = "\r\n";

/** RFC 5545 §3.3.5: basic-format UTC, no punctuation. */
function stamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, "").split(".")[0] ?? ""}Z`;
}

/** §3.3.11: backslash, semicolon, comma and newline are the four that bite. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * §3.1: no line may exceed 75 OCTETS. Folding by characters splits multi-byte
 * text mid-codepoint — and this platform's content is routinely Devanagari, so
 * that is a certainty rather than a corner case. Folded on encoded bytes, with
 * the continuation space every unfolder expects.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) {
    return line;
  }
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let cursor = 0;
  let limit = 75;
  while (cursor < bytes.length) {
    let take = Math.min(limit, bytes.length - cursor);
    // Never cut inside a UTF-8 sequence: continuation bytes are 10xxxxxx.
    while (take > 1 && (bytes[cursor + take] ?? 0) >> 6 === 0b10) {
      take -= 1;
    }
    parts.push(decoder.decode(bytes.subarray(cursor, cursor + take)));
    cursor += take;
    limit = 74; // subsequent lines carry a leading space
  }
  return parts.join(`${CRLF} `);
}

export interface CalendarInvite {
  readonly uid: string;
  readonly start: Date;
  readonly end: Date;
  readonly summary: string;
  readonly description: string;
  readonly url: string;
  readonly organizerEmail: string;
  /** Bumped on every reschedule so clients replace rather than duplicate. */
  readonly sequence: number;
  readonly cancelled?: boolean;
  readonly now?: Date;
}

export function buildInvite(invite: CalendarInvite): string {
  const now = invite.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DesiAuction//Demo//EN",
    "CALSCALE:GREGORIAN",
    // A cancellation is the same UID with METHOD:CANCEL — that is what makes a
    // calendar remove the entry instead of leaving a ghost in somebody's week.
    `METHOD:${invite.cancelled === true ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${invite.uid}`,
    `SEQUENCE:${String(invite.sequence)}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(invite.start)}`,
    `DTEND:${stamp(invite.end)}`,
    `SUMMARY:${escapeText(invite.summary)}`,
    `DESCRIPTION:${escapeText(invite.description)}`,
    `URL:${invite.url}`,
    `ORGANIZER:mailto:${invite.organizerEmail}`,
    `STATUS:${invite.cancelled === true ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}

/** Stable across reschedules — the booking's REQUEST, not the booking row. */
export function inviteUid(demoRequestId: string): string {
  return `demo-${demoRequestId}@desiauction.in`;
}
