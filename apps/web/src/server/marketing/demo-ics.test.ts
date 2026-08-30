import { describe, expect, it } from "vitest";

import { buildInvite, inviteUid } from "./demo-ics";

/**
 * The four things calendar clients actually care about, and the four things a
 * hand-built ICS gets wrong: CRLF endings, 75-octet folding, escaping, and a
 * stable UID with a moving SEQUENCE.
 */

const invite = {
  uid: inviteUid("01JABCDEFGHJKMNPQRSTVWXYZ0"),
  start: new Date("2026-09-02T13:30:00.000Z"),
  end: new Date("2026-09-02T14:00:00.000Z"),
  summary: "DesiAuction demo — Sunday Warriors",
  description: "A live walkthrough of a real auction.",
  url: "https://desiauction.in/demo/abc",
  organizerEmail: "support@desiauction.in",
  sequence: 0,
  now: new Date("2026-09-01T10:00:00.000Z"),
};

describe("buildInvite", () => {
  it("ends every line with CRLF, as the spec requires", () => {
    const ics = buildInvite(invite);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
    // No bare LF anywhere: a lone newline is what breaks Outlook.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("stamps times as basic-format UTC", () => {
    expect(buildInvite(invite)).toContain("DTSTART:20260902T133000Z");
    expect(buildInvite(invite)).toContain("DTEND:20260902T140000Z");
  });

  it("escapes the four characters that break a property value", () => {
    const ics = buildInvite({
      ...invite,
      description: "Line one\nhalf; comma, and a back\\slash",
    });
    expect(ics).toContain("\\n");
    expect(ics).toContain("\\;");
    expect(ics).toContain("\\,");
    expect(ics).toContain("\\\\");
  });

  it("folds long lines at 75 octets without splitting a codepoint", () => {
    const ics = buildInvite({ ...invite, description: "नीलामी ".repeat(40) });
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Folded content unfolds back to the original — no mangled characters.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("नीलामी");
  });

  it("keeps the UID stable across a reschedule and moves the SEQUENCE", () => {
    // This is what makes a calendar REPLACE the entry instead of accumulating
    // a second one beside it.
    const first = buildInvite(invite);
    const moved = buildInvite({ ...invite, sequence: 1, start: new Date("2026-09-03T13:30:00Z") });
    expect(first).toContain(`UID:${invite.uid}`);
    expect(moved).toContain(`UID:${invite.uid}`);
    expect(first).toContain("SEQUENCE:0");
    expect(moved).toContain("SEQUENCE:1");
  });

  it("cancels with METHOD:CANCEL and STATUS:CANCELLED, not by silence", () => {
    const ics = buildInvite({ ...invite, cancelled: true });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("derives the UID from the request, so it survives a new booking row", () => {
    expect(inviteUid("abc")).toBe("demo-abc@desiauction.in");
  });
});
