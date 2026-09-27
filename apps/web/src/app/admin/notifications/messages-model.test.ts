import { describe, expect, it } from "vitest";

import type {
  CellCounts,
  ChannelSwitchView,
  GridCell,
  GridGroup,
  GridRow,
  RecentChange,
} from "../../../server/admin/notification-views";
import {
  attentionOf,
  changesFor,
  channelHealth,
  channelShort,
  countsLine,
  chipOf,
  chipsOf,
  filterCounts,
  filterGroups,
  findRow,
  listWords,
  messageGroups,
  optOutSummary,
  plainCause,
  switchNote,
  type ChannelHealth,
} from "./messages-model";

const ZERO: CellCounts = { sent: 0, failed: 0, suppressed: 0, delivered: 0, read: 0 };
const LABEL = { email: "Email", whatsapp: "WhatsApp", sms: "SMS", in_app: "In-app" } as const;

function cell(channel: GridCell["channel"], over: Partial<GridCell> = {}): GridCell {
  return {
    channel,
    channelLabel: LABEL[channel],
    state: "on",
    kindEnabled: true,
    reason: null,
    notConfigured: null,
    templateIssue: false,
    template: null,
    counts: ZERO,
    ...over,
  };
}

function row(key: string, label: string, cells: GridCell[], over: Partial<GridRow> = {}): GridRow {
  return {
    key,
    label,
    description: `${label}, described.`,
    category: "transactional",
    locked: false,
    needsReason: false,
    person: { allowed: true, effective: true },
    org: { allowed: true, effective: true },
    cells,
    ...over,
  };
}

const EMAIL_UNSET = "Email provider not set up";
const WA_UNSET = "WhatsApp not set up";

const signIn = row(
  "auth.email_code",
  "Sign-in code by email",
  [cell("email", { state: "locked" })],
  {
    category: "login",
    locked: true,
    person: { allowed: false, effective: false },
    org: { allowed: false, effective: false },
  },
);
const approved = row("registration.approved", "Registration approved", [
  cell("sms", { counts: { ...ZERO, sent: 4026, failed: 3 } }),
  cell("in_app"),
  cell("email", { notConfigured: EMAIL_UNSET }),
  cell("whatsapp", { notConfigured: WA_UNSET }),
]);
const reminder = row(
  "demo.booking_reminder",
  "Demo reminder",
  [
    cell("email", {
      state: "admin_off",
      kindEnabled: false,
      reason: "Paused for the invite fix",
      notConfigured: EMAIL_UNSET,
    }),
  ],
  { person: { allowed: false, effective: false }, org: { allowed: false, effective: false } },
);

const GROUPS: GridGroup[] = [
  { key: "access", label: "Sign-in and security", rows: [signIn] },
  { key: "registration", label: "Registration", rows: [approved] },
  { key: "outside", label: "Demos and support", rows: [reminder] },
];

function channels(off: Partial<Record<string, string | null>> = {}): ChannelSwitchView[] {
  return (["email", "whatsapp", "sms", "in_app"] as const).map((channel) => ({
    channel,
    label: LABEL[channel],
    enabled: !(channel in off),
    reason: off[channel] ?? null,
    updatedAt: channel in off ? new Date("2026-09-27T10:00:00Z") : null,
  }));
}

describe("channelHealth", () => {
  it("says a channel is live, with its sent and failed counts over the window", () => {
    const sms = channelHealth(channels(), GROUPS, 30).find((c) => c.channel === "sms");
    expect(sms).toMatchObject({ state: "live", sent: 4026, failed: 3, blocked: 0 });
    expect(sms?.line).toBe("4,026 sent in the last 30 days");
  });

  it("says a channel with no provider is not set up, with the cause in plain words", () => {
    const email = channelHealth(channels(), GROUPS, 30).find((c) => c.channel === "email");
    expect(email).toMatchObject({ state: "not_set_up", blocked: 2 });
    expect(email?.line).toBe("Needs an email provider: its address, key and sender");
  });

  it("does not let a locked sign-in code make an unset channel look live", () => {
    // The sign-in code's email cell can send (dev inbox); it is not counted.
    const email = channelHealth(channels(), GROUPS, 30).find((c) => c.channel === "email");
    expect(email?.state).toBe("not_set_up");
  });

  it("says a switched-off channel is off everywhere, with its reason", () => {
    const sms = channelHealth(channels({ sms: "Provider incident" }), GROUPS, 30).find(
      (c) => c.channel === "sms",
    );
    expect(sms).toMatchObject({ state: "off", line: "Provider incident" });
    const bare = channelHealth(channels({ sms: null }), GROUPS, 30).find(
      (c) => c.channel === "sms",
    );
    expect(bare?.line).toBe("Switched off, no reason given");
  });

  it("keeps a live channel live when only some messages lack a template", () => {
    const groups: GridGroup[] = [
      {
        key: "g",
        label: "G",
        rows: [
          row("a", "A", [cell("whatsapp")]),
          row("b", "B", [cell("whatsapp", { notConfigured: "No approved template mapped" })]),
        ],
      },
    ];
    const wa = channelHealth(channels(), groups, 30).find((c) => c.channel === "whatsapp");
    expect(wa).toMatchObject({
      state: "live",
      blocked: 1,
      line: "Nothing sent in the last 30 days",
    });
  });

  it("passes an unknown cause through untouched", () => {
    expect(plainCause("Template not approved — paused")).toBe("Template not approved — paused");
  });
});

describe("attentionOf", () => {
  it("names the unset channels, where messages go meanwhile, and each switched-off message", () => {
    const attention = attentionOf(channelHealth(channels(), GROUPS, 30), GROUPS);
    expect(attention?.title).toBe("Email and WhatsApp aren't set up yet");
    expect(attention?.lines).toEqual(["Messages go by SMS and In-app until they are."]);
    expect(attention?.stoppedLead).toBe("1 message is switched off by an admin:");
    expect(attention?.stopped).toEqual([{ key: "demo.booking_reminder", label: "Demo reminder" }]);
  });

  it("leads with a channel switched off everywhere", () => {
    const attention = attentionOf(channelHealth(channels({ sms: "x" }), GROUPS, 30), GROUPS);
    expect(attention?.title).toBe("SMS is switched off everywhere");
    expect(attention?.lines[0]).toBe("Email and WhatsApp aren't set up yet.");
  });

  it("says nothing when every channel is live and nothing is switched off", () => {
    const allGood: GridGroup[] = [{ key: "g", label: "G", rows: [row("a", "A", [cell("sms")])] }];
    expect(attentionOf(channelHealth(channels(), allGood, 30), allGood)).toBeNull();
  });

  it("titles a switched-off message when the channels are fine", () => {
    const groups: GridGroup[] = [
      {
        key: "g",
        label: "G",
        rows: [row("a", "A", [cell("sms", { state: "admin_off", kindEnabled: false })])],
      },
    ];
    const attention = attentionOf(channelHealth(channels(), groups, 30), groups);
    expect(attention?.title).toBe("1 message is switched off");
    expect(attention?.stoppedLead).toBe("Switched off by an admin:");
  });
});

describe("row chips and opt-out words", () => {
  it("puts each channel's state in colour and word", () => {
    expect(chipOf(approved.cells[0] as GridCell)).toMatchObject({
      tone: "green",
      text: "SMS · 4,026",
    });
    expect(chipOf(approved.cells[1] as GridCell)).toMatchObject({ tone: "green", text: "In-app" });
    expect(chipOf(approved.cells[2] as GridCell)).toMatchObject({
      tone: "neutral",
      text: "Email · not set up",
    });
    expect(chipOf(reminder.cells[0] as GridCell)).toMatchObject({
      tone: "red",
      text: "Email · off",
    });
    expect(chipOf(signIn.cells[0] as GridCell)).toMatchObject({
      tone: "blue",
      text: "Email · always",
    });
    expect(chipOf(cell("sms", { state: "channel_off" }))).toMatchObject({
      tone: "amber",
      text: "SMS · channel off",
    });
  });

  it("lists live channels first, keeping the catalogue's order within a state", () => {
    const r = row("x", "X", [
      cell("email", { notConfigured: EMAIL_UNSET }),
      cell("sms"),
      cell("in_app"),
    ]);
    expect(chipsOf(r).map((chip) => chip.channel)).toEqual(["sms", "in_app", "email"]);
  });

  it("says who can opt out", () => {
    expect(optOutSummary(signIn)).toBe("Always sent");
    expect(optOutSummary(approved)).toBe("People & clubs can opt out");
    expect(optOutSummary(reminder)).toBe("Admin only");
    expect(optOutSummary({ ...approved, org: { allowed: true, effective: false } })).toBe(
      "People can opt out",
    );
    expect(optOutSummary({ ...approved, person: { allowed: false, effective: false } })).toBe(
      "Clubs can opt out",
    );
  });

  it("carries a switched-off message's reason onto its row", () => {
    const [, , outside] = messageGroups(GROUPS);
    expect(outside?.rows[0]).toMatchObject({
      off: true,
      offNotes: ["Off on Email — “Paused for the invite fix”"],
    });
  });
});

describe("search and quick filters", () => {
  const groups = messageGroups(GROUPS);

  it("counts every message, the switched-off and the locked", () => {
    expect(filterCounts(groups)).toEqual({ all: 3, off: 1, locked: 1 });
  });

  it("filters by state and drops the groups left empty", () => {
    expect(filterGroups(groups, "", "off").map((g) => g.key)).toEqual(["outside"]);
    expect(filterGroups(groups, "", "locked").map((g) => g.key)).toEqual(["access"]);
    expect(filterGroups(groups, "", "all")).toHaveLength(3);
  });

  it("searches names and descriptions, ignoring case and spaces", () => {
    expect(filterGroups(groups, "  APPROVED ", "all").map((g) => g.key)).toEqual(["registration"]);
    expect(filterGroups(groups, "described", "locked").map((g) => g.key)).toEqual(["access"]);
    expect(filterGroups(groups, "nothing like this", "all")).toEqual([]);
  });
});

describe("one message", () => {
  it("finds the message in the address, and nothing for an unknown one", () => {
    expect(findRow(GROUPS, "demo.booking_reminder")?.group.key).toBe("outside");
    expect(findRow(GROUPS, "nope")).toBeNull();
    expect(findRow(GROUPS, undefined)).toBeNull();
  });

  it("keeps only its own changes", () => {
    const change = (id: string, subject: string): RecentChange => ({
      id,
      at: new Date(),
      subject,
      actorName: null,
      summary: id,
      reason: null,
      revertOf: null,
      revertable: true,
    });
    const recent = [
      change("1", "demo.booking_reminder"),
      change("2", "sms"),
      change("3", "demo.booking_reminder"),
    ];
    expect(changesFor(recent, "demo.booking_reminder").map((c) => c.id)).toEqual(["1", "3"]);
  });

  it("joins words the way a sentence does", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["Email"])).toBe("Email");
    expect(listWords(["Email", "WhatsApp", "SMS"])).toBe("Email, WhatsApp and SMS");
  });
});

describe("the channel health, in one line", () => {
  it("says the one number a phone row has room for", () => {
    const health = channelHealth(channels(), GROUPS, 30);
    const of = (channel: string) => health.find((c) => c.channel === channel);
    expect(channelShort(of("sms") as ChannelHealth)).toBe("3 failed");
    expect(channelShort(of("email") as ChannelHealth)).toBe("2 waiting");
    expect(channelShort(of("in_app") as ChannelHealth)).toBe("Nothing sent");
    const off = channelHealth(channels({ sms: null }), GROUPS, 30).find((c) => c.channel === "sms");
    expect(channelShort(off as ChannelHealth)).toBe("Switched off");
    const clean: GridGroup[] = [
      {
        key: "g",
        label: "G",
        rows: [row("a", "A", [cell("sms", { counts: { ...ZERO, sent: 4472 } })])],
      },
    ];
    const live = channelHealth(channels(), clean, 30).find((c) => c.channel === "sms");
    expect(channelShort(live as ChannelHealth)).toBe("4,472 sent");
  });
});

describe("one channel of an open message", () => {
  it("says what was sent, failed and suppressed on a live channel", () => {
    expect(countsLine(cell("sms", { counts: { ...ZERO, sent: 4026, failed: 3 } }), 30)).toBe(
      "4,026 sent · 3 failed in 30 days",
    );
    expect(countsLine(cell("sms", { counts: { ...ZERO, suppressed: 7 } }), 30)).toBe(
      "7 suppressed in 30 days",
    );
    expect(countsLine(cell("in_app"), 7)).toBe("nothing sent in 7 days");
  });

  it("says what could not go on a channel that is not set up, and why, from the same count", () => {
    const email = cell("email", {
      notConfigured: EMAIL_UNSET,
      counts: { ...ZERO, suppressed: 4026 },
    });
    expect(countsLine(email, 30)).toBe("4,026 couldn't send in 30 days — Email isn't set up");
    const wa = cell("whatsapp", {
      notConfigured: "No approved template mapped",
      templateIssue: true,
      counts: { ...ZERO, suppressed: 12 },
    });
    expect(countsLine(wa, 30)).toBe("12 couldn't send in 30 days — no approved template yet");
    expect(countsLine(cell("email", { notConfigured: EMAIL_UNSET }), 30)).toBe(
      "nothing sent in 30 days",
    );
  });

  it("puts the admin's switch into words, apart from whether anything can send", () => {
    expect(switchNote(cell("sms"))).toBe("Switch is on — sending");
    expect(switchNote(cell("email", { notConfigured: EMAIL_UNSET }))).toBe(
      "Switch is on — sends once Email is set up",
    );
    expect(
      switchNote(cell("whatsapp", { notConfigured: "No template", templateIssue: true })),
    ).toBe("Switch is on — sends once it has an approved template");
    expect(switchNote(cell("sms", { state: "admin_off", kindEnabled: false }))).toBe(
      "Switched off by an admin",
    );
    expect(switchNote(cell("sms", { state: "channel_off" }))).toBe(
      "Switch is on — SMS is off everywhere",
    );
    expect(switchNote(cell("sms", { state: "channel_off", kindEnabled: false }))).toBe(
      "Switch is off — and SMS is off everywhere",
    );
    expect(switchNote(cell("email", { state: "locked" }))).toBe(
      "Always sent — can't be switched off",
    );
  });
});
