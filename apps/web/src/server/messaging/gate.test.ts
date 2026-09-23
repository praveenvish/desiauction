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
