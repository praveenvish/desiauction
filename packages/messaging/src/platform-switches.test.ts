import type { Db } from "@desiauction/db";
import { beforeEach, describe, expect, it } from "vitest";

import { NOTIFICATIONS, notificationOf } from "./catalogue";
import {
  CATALOGUE_DEFAULTS,
  PLATFORM_SWITCH_TTL_MS,
  effectiveOn,
  invalidatePlatformSwitches,
  orgSwitchTopics,
  personSwitchTopics,
  platformSwitches,
  refuseChange,
  type PlatformSwitches,
  type SwitchRow,
} from "./platform-switches";

/*
 * The admin layer's rules, without a database: the resolution over a snapshot,
 * the validation every change passes, the restrict-only overrides, and the
 * cache the gate reads through. The same rules against Postgres (the CHECKs,
 * the audit, the outbox) are apps/web notification-switches.regression.test.ts.
 */

function row(kind: string, channel: SwitchRow["channel"], over: Partial<SwitchRow>): SwitchRow {
  return {
    kind,
    channel,
    enabled: true,
    personControllable: null,
    orgControllable: null,
    reason: null,
    updatedBy: null,
    updatedAt: new Date(0),
    ...over,
  };
}

function snapshot(rows: SwitchRow[], killed: SwitchRow["channel"][] = []): PlatformSwitches {
  return {
    switches: new Map(rows.map((r) => [`${r.kind}|${r.channel}`, r])),
    channels: new Map(
      killed.map((channel) => [
        channel,
        { channel, enabled: false, reason: null, updatedBy: null, updatedAt: new Date(0) },
      ]),
    ),
  };
}

describe("the catalogue conventions 0086's CHECKs rely on", () => {
  it("names every login kind auth.* and every security kind security.*", () => {
    for (const entry of NOTIFICATIONS) {
      expect(entry.category === "login", entry.key).toBe(entry.key.startsWith("auth."));
      expect(entry.category === "security", entry.key).toBe(entry.key.startsWith("security."));
    }
  });
});

describe("effectiveOn — the admin layer's precedence", () => {
  const sold = notificationOf("auction.sold");

  it("with no rows is the catalogue, everything on", () => {
    const effective = effectiveOn(CATALOGUE_DEFAULTS, sold, "email");
    expect(effective.platform).toEqual({ enabled: true });
    expect(effective.personControllable).toBe(true);
    expect(effective.orgControllable).toBe(true);
  });

  it("the channel kill comes first, the kind's switch second", () => {
    const both = snapshot([row("auction.sold", "email", { enabled: false })], ["email"]);
    expect(effectiveOn(both, sold, "email").platform).toEqual({
      enabled: false,
      reason: "channel_disabled",
    });
    const kindOnly = snapshot([row("auction.sold", "email", { enabled: false })]);
    expect(effectiveOn(kindOnly, sold, "email").platform).toEqual({
      enabled: false,
      reason: "admin_disabled",
    });
    expect(effectiveOn(kindOnly, sold, "in_app").platform).toEqual({ enabled: true });
  });

  it("a login code is locked: no row and no channel kill reaches it", () => {
    const code = notificationOf("auth.email_code");
    const hostile = snapshot([row("auth.email_code", "email", { enabled: false })], ["email"]);
    expect(effectiveOn(hostile, code, "email").platform).toEqual({ enabled: true });
  });

  it("overrides only RESTRICT: FALSE narrows, and nothing widens a catalogue lock", () => {
    const narrowed = snapshot([
      row("auction.sold", "email", { personControllable: false, orgControllable: false }),
    ]);
    expect(effectiveOn(narrowed, sold, "email").personControllable).toBe(false);
    expect(effectiveOn(narrowed, sold, "email").orgControllable).toBe(false);
    // Per channel: the text switch stays the person's.
    expect(effectiveOn(narrowed, sold, "whatsapp").personControllable).toBe(true);

    // A row claiming TRUE (the column refuses it; this proves the code would
    // not honour it either) cannot hand a security alert to people or clubs.
    const alert = notificationOf("security.phone_changed");
    const widened = snapshot([
      row("security.phone_changed", "email", {
        personControllable: true,
        orgControllable: true,
      }),
    ]);
    expect(effectiveOn(widened, alert, "email").personControllable).toBe(false);
    expect(effectiveOn(widened, alert, "email").orgControllable).toBe(false);
  });
});

describe("the /account and /org switches follow controllability", () => {
  it("shows every catalogue topic with no rows", () => {
    expect(personSwitchTopics(CATALOGUE_DEFAULTS).map((t) => t.topic)).toEqual([
      "registration",
      "auction",
      "money",
      "feedback",
    ]);
    expect(orgSwitchTopics(CATALOGUE_DEFAULTS).map((t) => t.topic)).toEqual([
      "registration",
      "auction",
      "money",
    ]);
  });

  it("keeps a topic while ANY kind in it is still the person's, and hides it when none is", () => {
    const money = notificationOf("finance.document.issued");
    const oneChannel = snapshot([
      row(money.key, "email", { personControllable: false, orgControllable: false }),
    ]);
    expect(personSwitchTopics(oneChannel).map((t) => t.topic)).toContain("money");
    const allChannels = snapshot(
      money.channels.map((channel) =>
        row(money.key, channel, { personControllable: false, orgControllable: false }),
      ),
    );
    expect(personSwitchTopics(allChannels).map((t) => t.topic)).not.toContain("money");
    expect(orgSwitchTopics(allChannels).map((t) => t.topic)).not.toContain("money");
    expect(personSwitchTopics(allChannels).map((t) => t.topic)).toContain("auction");
  });
});

describe("refuseChange — what an admin may change", () => {
  it("refuses an unknown kind and an unknown or uncatalogued channel", () => {
    expect(
      refuseChange({ type: "switch", kind: "nope", channel: "email", enabled: false }),
    ).not.toBeNull();
    expect(
      refuseChange({ type: "switch", kind: "auction.sold", channel: "fax", enabled: false }),
    ).not.toBeNull();
    // auction.unsold is never texted.
    expect(
      refuseChange({ type: "switch", kind: "auction.unsold", channel: "sms", enabled: false }),
    ).not.toBeNull();
    expect(refuseChange({ type: "channel", channel: "pigeon", enabled: false })).not.toBeNull();
  });

  it("refuses every change to a login kind — off, on, or controllability", () => {
    for (const enabled of [false, true]) {
      expect(
        refuseChange({ type: "switch", kind: "auth.phone_code", channel: "sms", enabled }),
      ).toMatchObject({ ok: false });
    }
    expect(refuseChange({ type: "control", kind: "auth.email_code", person: false })).toMatchObject(
      { ok: false },
    );
  });

  it("refuses a security alert off without a reason of ten characters, and takes one with", () => {
    const base = {
      type: "switch",
      kind: "security.phone_changed",
      channel: "email",
      enabled: false,
    } as const;
    expect(refuseChange(base)).toMatchObject({ ok: false });
    expect(refuseChange({ ...base, reason: "   short  " })).toMatchObject({ ok: false });
    expect(refuseChange({ ...base, reason: "Provider incident until 18:00" })).toBeNull();
    // Switching one back ON needs no reason.
    expect(refuseChange({ ...base, enabled: true })).toBeNull();
    // A reason is optional for an ordinary kind, and bounded for all.
    expect(
      refuseChange({ type: "switch", kind: "auction.sold", channel: "email", enabled: false }),
    ).toBeNull();
    expect(
      refuseChange({
        type: "switch",
        kind: "auction.sold",
        channel: "email",
        enabled: false,
        reason: "x".repeat(501),
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses to restrict what the catalogue already locks, or nothing at all", () => {
    expect(
      refuseChange({ type: "control", kind: "security.email_changed", person: false }),
    ).toMatchObject({ ok: false });
    expect(refuseChange({ type: "control", kind: "staff.demo_request", org: false })).toMatchObject(
      { ok: false },
    );
    // review.platform_ask is the person's, but never a club's.
    expect(
      refuseChange({ type: "control", kind: "review.platform_ask", person: false }),
    ).toBeNull();
    expect(
      refuseChange({ type: "control", kind: "review.platform_ask", org: false }),
    ).toMatchObject({ ok: false });
    expect(refuseChange({ type: "control", kind: "auction.sold" })).toMatchObject({ ok: false });
  });
});

describe("the gate's cache", () => {
  /** A db whose two selects answer `rows`, counting how often it is read. */
  function countingDb(rows: () => SwitchRow[]): { db: Db; reads: () => number } {
    let reads = 0;
    let call = 0;
    const db = {
      select: () => ({
        from: () => {
          call += 1;
          // loadPlatformSwitches reads switches, then channels.
          if (call % 2 === 1) {
            reads += 1;
            return Promise.resolve(rows());
          }
          return Promise.resolve([]);
        },
      }),
    } as unknown as Db;
    return { db, reads: () => reads };
  }

  beforeEach(() => {
    invalidatePlatformSwitches();
  });

  it("reads once per TTL, and again at once after an invalidation", async () => {
    let current: SwitchRow[] = [];
    const { db, reads } = countingDb(() => current);
    const t0 = 1_000_000;
    await platformSwitches(db, t0);
    await platformSwitches(db, t0 + PLATFORM_SWITCH_TTL_MS - 1);
    expect(reads()).toBe(1);

    current = [row("auction.sold", "email", { enabled: false })];
    // Without an invalidation a write elsewhere is seen within the TTL…
    const stale = await platformSwitches(db, t0 + 1);
    expect(stale.switches.size).toBe(0);
    // …and a write in this process is seen at once.
    invalidatePlatformSwitches();
    const fresh = await platformSwitches(db, t0 + 2);
    expect(fresh.switches.get("auction.sold|email")?.enabled).toBe(false);
    expect(reads()).toBe(2);

    await platformSwitches(db, t0 + 2 + PLATFORM_SWITCH_TTL_MS);
    expect(reads()).toBe(3);
  });
});
