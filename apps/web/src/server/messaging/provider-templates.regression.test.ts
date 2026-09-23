// WHATSAPP AND SMS TEMPLATE MAPPING (Notification Control Center, Phase 3),
// against real Postgres: a mapping is audited, revertible and EFFECTIVE in the
// outbox's real WhatsApp send; clearing it returns to the env var; Meta's
// status sync stores a snapshot (over a fake transport) and is rate limited;
// a submission records what Meta answered; the database refuses what the code
// refuses; and nobody but a platform admin gets through the door.
import {
  auditLog,
  consentRecords,
  createDb,
  messageOutbox,
  newId,
  people,
  providerTemplateMappings,
  providerTemplateStatus,
  providerTemplateSyncs,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";

let operator: { personId: string } | null = null;
vi.mock("../admin/authz", () => ({
  platformAdminGate: () =>
    Promise.resolve(
      operator === null
        ? null
        : { personId: operator.personId, name: "Ops", phone: null, email: null },
    ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const {
  clearProviderTemplate,
  mapProviderTemplate,
  refreshTemplateStatus,
  revertProviderTemplate,
  submitProviderTemplate,
} = await import("../admin/provider-template-actions");
const { drainOutbox, enqueueSms } = await import("./outbox");
const { invalidateProviderTemplateMappings } = await import("./provider-templates");
const { submitForApproval, syncWhatsAppTemplates, TEMPLATE_AUDIT_ACTIONS } =
  await import("./provider-template-writer");
const { providerTemplatesView } = await import("../admin/provider-template-views");
const { notificationControlCenter } = await import("../admin/notification-views");
const { setWhatsappOptIn } = await import("./whatsapp");

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const NOON_IST = new Date("2026-09-20T06:30:00Z");
const admin = newId();
const player = newId();
const PLAYER_PHONE = `+9194${RUN}2`;
const envRecord = env as unknown as Readonly<Record<string, string | undefined>>;
const ENV_SOLD = envRecord["WHATSAPP_TEMPLATE_AUCTION_SOLD"];

function sale(key: string) {
  return {
    personId: player,
    orgId: null,
    kind: "auction.sold" as const,
    dedupeKey: `ptm:${RUN}:${key}`,
    templateKey: "auction.sold" as const,
    slots: { team: "Cup Kings", price: "Rs 75,000", competition: "MPL 2026" },
  };
}

function recordingWhatsApp() {
  const sent: { name: string; language: string }[] = [];
  return {
    sent,
    send: vi.fn((_phone: string, message: { name: string; language: string }) => {
      sent.push({ name: message.name, language: message.language });
      return Promise.resolve({ messageId: `wamid.ptm.${RUN}.${newId()}` });
    }),
  };
}

function recordingSms() {
  const sent: string[] = [];
  return {
    sent,
    send: vi.fn((to: string) => {
      sent.push(to);
      return Promise.resolve();
    }),
  };
}

async function reset(): Promise<void> {
  await db.delete(providerTemplateMappings);
  await db.delete(providerTemplateStatus);
  await db.delete(providerTemplateSyncs);
  invalidateProviderTemplateMappings();
}

beforeAll(async () => {
  await db.insert(people).values([
    { id: admin, phone: `+9194${RUN}1`, name: "Template Operator" },
    // Hindi reader: the mapping's languages decide which version they get.
    { id: player, phone: PLAYER_PHONE, name: "Template Player", language: "hi" },
  ]);
  await setWhatsappOptIn(db, { personId: player, granted: true, source: "registration" });
  await reset();
});

afterEach(async () => {
  operator = null;
  await reset();
});

afterAll(async () => {
  await reset();
  await db.delete(auditLog).where(eq(auditLog.actor, admin));
  await db.delete(messageOutbox).where(eq(messageOutbox.personId, player));
  await db.delete(consentRecords).where(eq(consentRecords.personId, player));
  await db.delete(people).where(inArray(people.id, [admin, player]));
  await handle.sql.end();
});

describe("the door", () => {
  it("refuses anyone who is not a platform admin, and writes nothing", async () => {
    operator = null;
    const refused = { ok: false, error: "Not available." };
    expect(await mapProviderTemplate("auction.sold", "whatsapp", "da_sold")).toEqual(refused);
    expect(await clearProviderTemplate("auction.sold", "whatsapp")).toEqual(refused);
    expect(await refreshTemplateStatus()).toEqual(refused);
    expect(await submitProviderTemplate("team.appointed", "da_x", ["en"])).toEqual(refused);
    expect(await revertProviderTemplate(newId())).toEqual(refused);
    expect(await db.select().from(providerTemplateMappings)).toEqual([]);
  });
});

describe("a mapping reaches the real WhatsApp send", () => {
  it("the outbox sends under the mapped name, in the language it is approved in; clear goes back to env", async () => {
    operator = { personId: admin };
    const mapped = await mapProviderTemplate(
      "auction.sold",
      "whatsapp",
      "da_sold_admin_v2",
      ["en"],
      "Approved 2026-09-23",
    );
    expect(mapped, JSON.stringify(mapped)).toMatchObject({ ok: true });

    const wa = recordingWhatsApp();
    const sms = recordingSms();
    await enqueueSms([sale("mapped")], db);
    // No `whatsappTemplate` injected: the drain resolves it as production does.
    await drainOutbox({ db, whatsapp: wa, sms, now: NOON_IST, personIds: [player] });
    // A Hindi reader, but the mapping says English only: English at once.
    expect(wa.sent).toEqual([{ name: "da_sold_admin_v2", language: "en" }]);
    expect(sms.sent).toEqual([]);

    // Audited with before and after.
    const [row] = await db
      .select({ action: auditLog.action, subject: auditLog.subject, meta: auditLog.meta })
      .from(auditLog)
      .where(eq(auditLog.actor, admin));
    expect(row).toMatchObject({
      action: TEMPLATE_AUDIT_ACTIONS.mapping,
      subject: "auction.sold",
      meta: {
        change: "mapping",
        channel: "whatsapp",
        before: null,
        after: { providerTemplateName: "da_sold_admin_v2", languages: ["en"] },
      },
    });

    // Clear: the env var decides again.
    expect(await clearProviderTemplate("auction.sold", "whatsapp")).toMatchObject({ ok: true });
    expect(await db.select().from(providerTemplateMappings)).toEqual([]);
    await enqueueSms([sale("cleared")], db);
    await drainOutbox({ db, whatsapp: wa, sms, now: NOON_IST, personIds: [player] });
    if (ENV_SOLD === undefined || ENV_SOLD === "") {
      expect(wa.sent, "no env name: nothing more on WhatsApp").toHaveLength(1);
      expect(sms.sent).toEqual([PLAYER_PHONE]);
    } else {
      expect(wa.sent[1]).toEqual({ name: ENV_SOLD, language: "hi" });
    }
  });

  it("revert re-applies what a change replaced, and refuses once the mapping moved on", async () => {
    operator = { personId: admin };
    await mapProviderTemplate("team.appointed", "whatsapp", "da_team_v1");
    await mapProviderTemplate("team.appointed", "whatsapp", "da_team_v2");
    const changes = await db
      .select({ id: auditLog.id, meta: auditLog.meta })
      .from(auditLog)
      .where(eq(auditLog.subject, "team.appointed"))
      .orderBy(auditLog.at, auditLog.id);
    const first = changes.at(-2);
    const second = changes.at(-1);
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    // The older change cannot be reverted over the newer one.
    expect(await revertProviderTemplate(first?.id ?? "")).toMatchObject({ ok: false });
    expect(await revertProviderTemplate(second?.id ?? "")).toMatchObject({ ok: true });
    const [now] = await db
      .select({ name: providerTemplateMappings.providerTemplateName })
      .from(providerTemplateMappings)
      .where(eq(providerTemplateMappings.kind, "team.appointed"));
    expect(now?.name).toBe("da_team_v1");

    // The page lists both, and offers revert only where it still applies.
    const view = await providerTemplatesView(db, envRecord);
    const row = view.whatsapp.find((r) => r.kind === "team.appointed");
    expect(row?.mapped).toMatchObject({ handle: "da_team_v1", source: "admin" });
    expect(view.recent.length).toBeGreaterThanOrEqual(3);
    expect(view.recent[0]).toMatchObject({ revertable: true });
  });

  it("the grid cell names the mapped template and its source", async () => {
    operator = { personId: admin };
    await mapProviderTemplate("lineup.announced", "whatsapp", "da_lineup_admin");
    const center = await notificationControlCenter(db, envRecord);
    const cell = center.groups
      .flatMap((g) => g.rows)
      .find((r) => r.key === "lineup.announced")
      ?.cells.find((c) => c.channel === "whatsapp");
    expect(cell?.template).toEqual({
      handle: "da_lineup_admin",
      source: "admin",
      approval: "unknown",
    });
  });
});

describe("the database refuses what the code refuses", () => {
  it("a login kind, a bad name, and the wrong handle for a channel", async () => {
    const bad = [
      { kind: "auth.phone_code", channel: "whatsapp", providerTemplateName: "otp" },
      { kind: "auction.sold", channel: "whatsapp", providerTemplateName: "Bad-Name" },
      { kind: "auction.sold", channel: "sms", providerTemplateName: "da_sold" },
      { kind: "auction.sold", channel: "email", providerTemplateName: "da_sold" },
    ];
    for (const values of bad) {
      await expect(
        db.insert(providerTemplateMappings).values(values as never),
        JSON.stringify(values),
      ).rejects.toThrow();
    }
  });
});

describe("Meta's status", () => {
  const page = (data: unknown[]) => JSON.stringify({ data, paging: { cursors: {} } });

  it("the refresh action says sync is off without a WABA id", async () => {
    operator = { personId: admin };
    if ((envRecord["WHATSAPP_BUSINESS_ACCOUNT_ID"] ?? "") !== "") return;
    expect(await refreshTemplateStatus()).toMatchObject({
      ok: false,
      error: expect.stringContaining("WHATSAPP_BUSINESS_ACCOUNT_ID") as unknown,
    });
  });

  it("a sync replaces the snapshot, records itself, and is rate limited", async () => {
    const transport = vi.fn(() =>
      Promise.resolve({
        status: 200,
        body: page([
          { name: "da_sold_admin_v2", language: "en", status: "APPROVED", category: "UTILITY" },
          {
            name: "da_sold_admin_v2",
            language: "hi",
            status: "REJECTED",
            rejected_reason: "INVALID_FORMAT",
          },
        ]),
      }),
    );
    const config = { wabaId: "1234567", accessToken: "tok", transport };
    const t0 = new Date("2026-09-23T10:00:00Z");
    expect(await syncWhatsAppTemplates(db, config, { now: t0 })).toEqual({ ok: true, count: 2 });
    const rows = await db.select().from(providerTemplateStatus);
    expect(rows.map((r) => `${r.language}:${r.status}`).sort()).toEqual([
      "en:APPROVED",
      "hi:REJECTED",
    ]);
    const [sync] = await db.select().from(providerTemplateSyncs);
    expect(sync).toMatchObject({ templateCount: 2, lastError: null });

    // Within the interval: no second call to Meta.
    const soon = await syncWhatsAppTemplates(db, config, { now: new Date(t0.getTime() + 5000) });
    expect(soon).toMatchObject({ ok: false, reason: "too_soon" });
    expect(transport).toHaveBeenCalledTimes(1);

    // A failed sync keeps the last snapshot and records why.
    const failing = {
      ...config,
      transport: vi.fn(() => Promise.resolve({ status: 503, body: "" })),
    };
    const later = new Date(t0.getTime() + 120_000);
    expect(await syncWhatsAppTemplates(db, failing, { now: later })).toMatchObject({
      ok: false,
      reason: "failed",
    });
    expect(await db.select().from(providerTemplateStatus)).toHaveLength(2);
    const [after] = await db.select().from(providerTemplateSyncs);
    expect(after?.lastError).toMatch(/unavailable/);
  });

  it("a submission records Meta's answer as PENDING and on the audit log", async () => {
    const transport = vi.fn(() =>
      Promise.resolve({
        status: 200,
        body: JSON.stringify({ id: `mt${RUN}`, status: "PENDING", category: "UTILITY" }),
      }),
    );
    const result = await submitForApproval(
      { db, auditDb: db },
      admin,
      { kind: "team.appointed", name: "da_team_appointed_v3", languages: ["en", "hi"] },
      { wabaId: "1234567", accessToken: "tok", transport },
    );
    expect(result).toMatchObject({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
    const rows = await db
      .select()
      .from(providerTemplateStatus)
      .where(eq(providerTemplateStatus.name, "da_team_appointed_v3"));
    expect(rows.map((r) => `${r.language}:${r.status}:${r.source}`).sort()).toEqual([
      "en:PENDING:submitted",
      "hi:PENDING:submitted",
    ]);
    const [audit] = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(eq(auditLog.action, TEMPLATE_AUDIT_ACTIONS.submit));
    expect(audit?.meta).toMatchObject({ change: "submit", name: "da_team_appointed_v3" });

    // A picture template is refused before Meta is called.
    const picture = await submitForApproval(
      { db, auditDb: db },
      admin,
      { kind: "auction.sold", name: "da_sold_x", languages: ["en"] },
      { wabaId: "1234567", accessToken: "tok", transport },
    );
    expect(picture).toMatchObject({ ok: false });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
