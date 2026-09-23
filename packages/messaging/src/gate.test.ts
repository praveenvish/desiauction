import type { Db } from "@desiauction/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The gate's PRECEDENCE, without a database: which layers each kind is allowed
 * to see. `maySend` is the layers themselves (suppression → person → club →
 * consent) and is pinned against a real database by consent.regression and
 * gate.regression; here it is a spy, so the question is only "what did the
 * gate let it look at?".
 */
const maySend = vi.fn();
vi.mock("./consent", () => ({
  maySend: (...args: unknown[]): unknown => maySend(...args) as unknown,
}));

/*
 * The admin layer's snapshot, set per test. The resolution over it
 * (`effectiveOn`) is the real one; only the database read is replaced.
 */
type Snapshot = import("./platform-switches").PlatformSwitches;
let platform: Snapshot = { switches: new Map(), channels: new Map() };
const loads = vi.fn();
vi.mock("./platform-switches", async (importOriginal) => {
  const real = await importOriginal<typeof import("./platform-switches")>();
  const read = (): Promise<Snapshot> => {
    loads();
    return Promise.resolve(platform);
  };
  return {
    ...real,
    platformSwitches: read,
    withPlatformSwitches: async (
      _db: unknown,
      entry: Parameters<typeof real.effectiveOn>[1],
      channel: Parameters<typeof real.effectiveOn>[2],
    ) =>
      entry.category === "login"
        ? real.effectiveOn(real.CATALOGUE_DEFAULTS, entry, channel)
        : real.effectiveOn(await read(), entry, channel),
  };
});

const { hiddenInboxActions, notificationGate } = await import("./gate");

/** A db whose one query (the in-app preference read) answers `topicsOff`. */
function fakeDb(topicsOff: string[] = []): Db {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(topicsOff.map((topic) => ({ topic }))),
  };
  return { select: () => chain } as unknown as Db;
}

const PERSON = "01PERSON00000000000000000A";
const ORG = "01ORG0000000000000000000A";

beforeEach(() => {
  platform = { switches: new Map(), channels: new Map() };
  loads.mockReset();
  maySend.mockReset();
  maySend.mockResolvedValue({ send: true });
});

describe("notificationGate — who may stop what", () => {
  it("sends a login code past every layer, a STOP included", async () => {
    maySend.mockResolvedValue({ send: false, reason: "suppressed" });
    const decision = await notificationGate(fakeDb(), {
      kind: "auth.phone_code",
      channel: "sms",
      recipient: { personId: PERSON, contact: "+919999000001" },
      orgId: ORG,
    });
    expect(decision).toEqual({ send: true });
    expect(maySend, "no layer is even asked").not.toHaveBeenCalled();
  });

  it("lets a STOP stop a security alert, but no person's or club's switch", async () => {
    await notificationGate(fakeDb(), {
      kind: "security.phone_changed",
      channel: "email",
      recipient: { personId: PERSON, contact: "a@example.com" },
      orgId: ORG,
    });
    const [, asked] = maySend.mock.calls[0] as [Db, Record<string, unknown>];
    expect(asked).toMatchObject({ contact: "a@example.com", channel: "email", scope: "security" });
    expect(asked, "the person's switch is not read").not.toHaveProperty("personId");
    expect(asked, "nor the club's").not.toHaveProperty("orgId");
  });

  it("hands a transactional kind every layer: suppression, person, club", async () => {
    maySend.mockResolvedValue({ send: false, reason: "org_disabled" });
    const decision = await notificationGate(fakeDb(), {
      kind: "registration.approved",
      channel: "email",
      recipient: { personId: PERSON, contact: "a@example.com" },
      orgId: ORG,
    });
    expect(decision).toEqual({ send: false, reason: "org_disabled" });
    expect(maySend.mock.calls[0]?.[1]).toMatchObject({
      scope: "registration",
      category: "transactional",
      personId: PERSON,
      orgId: ORG,
    });
  });

  it("files a receipt under the money switch", async () => {
    await notificationGate(fakeDb(), {
      kind: "finance.document.issued",
      channel: "email",
      recipient: { personId: PERSON, contact: "a@example.com" },
      orgId: ORG,
    });
    expect(maySend.mock.calls[0]?.[1]).toMatchObject({ scope: "money", personId: PERSON });
  });

  it("asks about WhatsApp on the text row", async () => {
    await notificationGate(fakeDb(), {
      kind: "auction.sold",
      channel: "whatsapp",
      recipient: { personId: PERSON, contact: "+919999000001" },
    });
    expect(maySend.mock.calls[0]?.[1]).toMatchObject({ channel: "sms", scope: "auction" });
  });

  it("checks only suppression for a stranger's demo mail", async () => {
    await notificationGate(fakeDb(), {
      kind: "demo.booking_reminder",
      channel: "email",
      recipient: { contact: "lead@example.com" },
    });
    const asked = maySend.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(asked).toMatchObject({ contact: "lead@example.com", scope: "demo" });
    expect(asked).not.toHaveProperty("personId");
  });

  it("never lets a person switch off a staff notice", async () => {
    await notificationGate(fakeDb(), {
      kind: "staff.problem_report",
      channel: "email",
      recipient: { personId: PERSON, contact: "support@desiauction.in" },
    });
    expect(maySend.mock.calls[0]?.[1]).not.toHaveProperty("personId");
  });

  it("refuses a channel the entry does not list", async () => {
    const decision = await notificationGate(fakeDb(), {
      kind: "auction.unsold",
      channel: "sms",
      recipient: { personId: PERSON, contact: "+919999000001" },
    });
    expect(decision).toEqual({ send: false, reason: "channel_not_catalogued" });
    expect(maySend).not.toHaveBeenCalled();
  });

  it("reads the person's in-app switch for in-app, and no suppression", async () => {
    const off = await notificationGate(fakeDb(["money"]), {
      kind: "finance.document.issued",
      channel: "in_app",
      recipient: { personId: PERSON, contact: "" },
    });
    expect(off).toEqual({ send: false, reason: "opted_out" });
    const on = await notificationGate(fakeDb(["money"]), {
      kind: "auction.sold",
      channel: "in_app",
      recipient: { personId: PERSON, contact: "" },
    });
    expect(on).toEqual({ send: true });
    expect(maySend).not.toHaveBeenCalled();
  });
});

describe("hiddenInboxActions — the in-app gate at read time", () => {
  it("hides every in-app kind on a switched-off topic, by its inbox name", async () => {
    const hidden = await hiddenInboxActions(fakeDb(["auction"]), PERSON);
    expect(hidden).toContain("auction.sold");
    expect(hidden).toContain("fixture.lineup_announced");
    expect(hidden).not.toContain("lineup.announced");
    expect(hidden).not.toContain("registration.approved");
  });

  it("hides nothing for a person with no in-app switch off", async () => {
    expect(await hiddenInboxActions(fakeDb(), PERSON)).toEqual([]);
  });
});

/** A switch row as the admin screen writes it. */
function switchRow(
  kind: string,
  channel: "email" | "whatsapp" | "sms" | "in_app",
  over: { enabled?: boolean; personControllable?: false; orgControllable?: false; reason?: string },
) {
  return [
    `${kind}|${channel}`,
    {
      kind,
      channel,
      enabled: over.enabled ?? true,
      personControllable: over.personControllable ?? null,
      orgControllable: over.orgControllable ?? null,
      reason: over.reason ?? null,
      updatedBy: null,
      updatedAt: new Date(),
    },
  ] as const;
}

function channelRow(channel: "email" | "whatsapp" | "sms" | "in_app", enabled: boolean) {
  return [
    channel,
    { channel, enabled, reason: null, updatedBy: null, updatedAt: new Date() },
  ] as const;
}

describe("notificationGate — the platform's switches (Phase 1)", () => {
  it("stops a kind an admin switched off on that channel, before any other layer", async () => {
    platform = {
      switches: new Map([switchRow("auction.sold", "email", { enabled: false })]),
      channels: new Map(),
    };
    const decision = await notificationGate(fakeDb(), {
      kind: "auction.sold",
      channel: "email",
      recipient: { personId: PERSON, contact: "a@example.com" },
    });
    expect(decision).toEqual({ send: false, reason: "admin_disabled" });
    expect(maySend).not.toHaveBeenCalled();
    // …and only on that channel.
    const text = await notificationGate(fakeDb(), {
      kind: "auction.sold",
      channel: "whatsapp",
      recipient: { personId: PERSON, contact: "+919999000001" },
    });
    expect(text).toEqual({ send: true });
  });

  it("a channel kill beats a kind that is on, and says it was the channel", async () => {
    platform = {
      switches: new Map([switchRow("registration.approved", "whatsapp", { enabled: false })]),
      channels: new Map([channelRow("whatsapp", false)]),
    };
    const decision = await notificationGate(fakeDb(), {
      kind: "registration.approved",
      channel: "whatsapp",
      recipient: { personId: PERSON, contact: "+919999000001" },
    });
    expect(decision).toEqual({ send: false, reason: "channel_disabled" });
  });

  it("never stops a login code — not a kind switch, not a channel kill, and never reads them", async () => {
    platform = {
      switches: new Map([switchRow("auth.phone_code", "whatsapp", { enabled: false })]),
      channels: new Map([channelRow("whatsapp", false), channelRow("sms", false)]),
    };
    for (const channel of ["whatsapp", "sms"] as const) {
      const decision = await notificationGate(fakeDb(), {
        kind: "auth.phone_code",
        channel,
        recipient: { contact: "+919999000001" },
      });
      expect(decision, channel).toEqual({ send: true });
    }
    expect(loads, "a sign-in code does not depend on the table").not.toHaveBeenCalled();
  });

  it("stops a security alert an admin switched off (with a reason)", async () => {
    platform = {
      switches: new Map([
        switchRow("security.email_changed", "email", {
          enabled: false,
          reason: "provider incident, back tonight",
        }),
      ]),
      channels: new Map(),
    };
    const decision = await notificationGate(fakeDb(), {
      kind: "security.email_changed",
      channel: "email",
      recipient: { personId: PERSON, contact: "a@example.com" },
    });
    expect(decision).toEqual({ send: false, reason: "admin_disabled" });
  });

  it("a kind made not person-controllable stops showing the person's switch to the layers", async () => {
    platform = {
      switches: new Map([
        switchRow("registration.approved", "email", { personControllable: false }),
      ]),
      channels: new Map(),
    };
    await notificationGate(fakeDb(), {
      kind: "registration.approved",
      channel: "email",
      recipient: { personId: PERSON, contact: "a@example.com" },
      orgId: ORG,
    });
    const asked = maySend.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(asked, "the person's switch no longer applies").not.toHaveProperty("personId");
    expect(asked, "the club's still does").toMatchObject({ orgId: ORG });
  });

  it("a kind made not club-controllable stops showing the club's switch", async () => {
    platform = {
      switches: new Map([switchRow("registration.approved", "email", { orgControllable: false })]),
      channels: new Map(),
    };
    await notificationGate(fakeDb(), {
      kind: "registration.approved",
      channel: "email",
      recipient: { personId: PERSON, contact: "a@example.com" },
      orgId: ORG,
    });
    const asked = maySend.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(asked).not.toHaveProperty("orgId");
    expect(asked).toMatchObject({ personId: PERSON });
  });

  it("an in-app opt-out stops applying once the kind is not the person's to switch", async () => {
    platform = {
      switches: new Map([
        switchRow("finance.document.issued", "in_app", { personControllable: false }),
      ]),
      channels: new Map(),
    };
    const decision = await notificationGate(fakeDb(["money"]), {
      kind: "finance.document.issued",
      channel: "in_app",
      recipient: { personId: PERSON, contact: "" },
    });
    expect(decision).toEqual({ send: true });
  });

  it("hides an in-app kind an admin switched off, and one whose channel is killed", async () => {
    platform = {
      switches: new Map([switchRow("auction.sold", "in_app", { enabled: false })]),
      channels: new Map(),
    };
    const hidden = await hiddenInboxActions(fakeDb(), PERSON);
    expect(hidden).toEqual(["auction.sold"]);
    platform = { switches: new Map(), channels: new Map([channelRow("in_app", false)]) };
    const all = await hiddenInboxActions(fakeDb(), PERSON);
    expect(all).toContain("registration.approved");
    expect(all).toContain("fixture.lineup_announced");
  });
});
