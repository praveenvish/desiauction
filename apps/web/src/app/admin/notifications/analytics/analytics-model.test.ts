import { describe, expect, it } from "vitest";

import {
  cellWords,
  channelSentence,
  headlineFigures,
  kindMatrix,
  leadFinding,
  totalsOf,
} from "./analytics-model";

describe("the delivery headline", () => {
  const channels = [
    { sent: 0, failed: 0, suppressed: 4896, pending: 0 },
    { sent: 4472, failed: 3, suppressed: 0, pending: 2 },
  ];

  it("adds the channels up, pending counted as queued", () => {
    expect(totalsOf(channels)).toEqual({
      queued: 9373,
      sent: 4472,
      suppressed: 4896,
      failed: 3,
    });
  });

  it("gives each figure the one fact that reads it", () => {
    const figures = headlineFigures(totalsOf(channels), 30);
    expect(figures.map((f) => [f.label, f.value, f.hint])).toEqual([
      ["Queued", 9373, "Last 30 days"],
      ["Sent", 4472, "47.7% of queued"],
      ["Held back", 4896, "Not sent — see the reasons"],
      ["Failed", 3, "0.1% failure rate"],
    ]);
    expect(figures.find((f) => f.key === "failed")?.alarm).toBe(true);
  });

  it("stays calm over an empty window", () => {
    const figures = headlineFigures(totalsOf([]), 7);
    expect(figures.map((f) => f.hint)).toEqual([
      "Last 7 days",
      "— of queued",
      "None held back",
      "— failure rate",
    ]);
    expect(figures.some((f) => f.alarm)).toBe(false);
  });
});

describe("the finding", () => {
  const name = (label: string) => (label === "no_verified_email" ? "No verified email" : label);
  const ch = (c: string) => (c === "email" ? "Email" : c);
  const totals = { queued: 11266, sent: 5023, suppressed: 5942, failed: 0 };

  it("says when one reason held back everything", () => {
    const f = leadFinding(
      totals,
      [{ label: "no_verified_email", count: 5942, channels: ["email"] }],
      name,
      ch,
    );
    expect(f?.title).toBe("5,942 of 11,266 messages never went — all for one reason");
    expect(f?.body).toBe("No verified email (Email) held back every one of them. Nothing failed.");
  });

  it("names the top two when the reasons share it", () => {
    const f = leadFinding(
      { ...totals, suppressed: 10, failed: 2 },
      [
        { label: "a", count: 7, channels: [] },
        { label: "b", count: 5, channels: [] },
      ],
      name,
      ch,
    );
    expect(f?.body).toBe("Mostly a — 7 — and b — 5.");
  });

  it("is calm when everything went, and absent when nothing was queued", () => {
    expect(leadFinding({ queued: 3, sent: 3, suppressed: 0, failed: 0 }, [], name, ch)?.tone).toBe(
      "ok",
    );
    expect(leadFinding({ queued: 0, sent: 0, suppressed: 0, failed: 0 }, [], name, ch)).toBeNull();
  });
});

describe("a channel, a cell, a message", () => {
  it("says a quiet channel in words, and names the development inbox", () => {
    const none = { sent: 0, failed: 0, suppressed: 0, pending: 0 };
    expect(channelSentence(none, "WhatsApp", 30, false)).toBe(
      "Nothing went on WhatsApp in the last 30 days",
    );
    expect(channelSentence({ ...none, sent: 5023, pending: 301 }, "SMS", 30, true)).toBe(
      "5,023 to the development inbox · 301 still queued",
    );
  });

  it("gives each cell its words, or none", () => {
    expect(cellWords({ sent: 0, failed: 0, suppressed: 4761, pending: 0 })).toBe("4,761 held back");
    expect(cellWords(undefined)).toBeNull();
  });

  it("folds one row per channel into one row per message, busiest first", () => {
    const rows = kindMatrix([
      { kind: "a", label: "A", channel: "sms", sent: 5, failed: 0, suppressed: 0, pending: 0 },
      { kind: "b", label: "B", channel: "email", sent: 0, failed: 0, suppressed: 90, pending: 0 },
      { kind: "a", label: "A", channel: "email", sent: 0, failed: 0, suppressed: 9, pending: 0 },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["b", "a"]);
    expect(Object.keys(rows[1]?.cells ?? {})).toEqual(["sms", "email"]);
  });
});
