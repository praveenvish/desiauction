// EDITABLE EMAIL WORDING (Notification Control Center, Phase 2), against real
// Postgres: only a platform admin edits; a publish is audited and reaches a real
// send at once; restore and reset are audited and effective; a person's one
// language picks the Hindi wording; an invalid row never blanks a mail; the
// test send goes only to the operator and stops at ten an hour; the database
// refuses what the code refuses.
import {
  auditLog,
  createDb,
  messageOutbox,
  newId,
  notificationTemplates,
  people,
  type DbHandle,
} from "@desiauction/db";
import { composeFinanceMail } from "@desiauction/messaging/finance-delivery";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent, type TemplateContent } from "@desiauction/messaging/email-templates";
import { invalidateTemplates } from "@desiauction/messaging/template-store";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";

/*
 * The actions' door, as in notification-switches.regression.test.ts:
 * `platformAdminGate` answers whoever `operator` names, so the refusal and the
 * write are both the real action.
 */
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
  previewTemplateAction,
  publishTemplateAction,
  resetTemplateAction,
  restoreTemplateVersionAction,
  saveTemplateDraftAction,
  sendTemplateTestAction,
} = await import("../admin/template-actions");
const { sendTemplateTest, TEMPLATE_AUDIT_ACTIONS, TEST_SENDS_PER_HOUR } =
  await import("./template-writer");
const { drainOutbox, enqueueMail } = await import("./outbox");
const { unsoldMail } = await import("./player-mail");
const { notifyEmailChanged } = await import("../auth/email-changed-notice");
const { adminTemplateEditor, wordingSummaries } = await import("../admin/template-views");

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const admin = newId();
const noEmailAdmin = newId();
const player = newId();
const hindiPlayer = newId();
const ADMIN_EMAIL = `tpl-admin-${RUN}@example.test`;
const PLAYER_EMAIL = `tpl-player-${RUN}@example.test`;
const HINDI_EMAIL = `tpl-hindi-${RUN}@example.test`;

const UNSOLD = EMAIL_TEMPLATES["auction.unsold"];

function withSubject(subject: string, language: "en" | "hi" = "en"): TemplateContent {
  const base = defaultContent(UNSOLD, language);
  const fields = base.variants["default"];
  if (fields === undefined) throw new Error("no default");
  return { variants: { default: { ...fields, subject } } };
}

function recordingMailer() {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    sent,
    send: vi.fn((mail: { to: string; subject: string; text: string }) => {
      sent.push({ to: mail.to, subject: mail.subject, text: mail.text });
      return Promise.resolve("sent" as const);
    }),
  };
}

const facts = { name: "Rohit", season: `TPL ${RUN}`, orgName: "Malad CC" };

/** Queue an unsold mail for `personId` in `language` and drain it; the subject that went. */
async function sendUnsold(personId: string, key: string, language: "en" | "hi" = "en") {
  const mail = await unsoldMail(facts, language);
  await enqueueMail(
    [{ personId, orgId: null, kind: "auction.unsold", dedupeKey: `tpl:${RUN}:${key}`, ...mail }],
    db,
  );
  const mailer = recordingMailer();
  await drainOutbox({ db, mailer, personIds: [personId] });
  return mailer.sent;
}

async function audits(action: string) {
  return db
    .select({ subject: auditLog.subject, meta: auditLog.meta, scopeType: auditLog.scopeType })
    .from(auditLog)
    .where(and(eq(auditLog.actor, admin), eq(auditLog.action, action)));
}

async function clearTemplates(): Promise<void> {
  await db
    .delete(notificationTemplates)
    .where(inArray(notificationTemplates.createdBy, [admin, noEmailAdmin]));
  invalidateTemplates();
}

beforeAll(async () => {
  const verified = new Date();
  await db.insert(people).values([
    {
      id: admin,
      phone: `+9194${RUN}1`,
      name: "Wording Operator",
      email: ADMIN_EMAIL,
      emailVerifiedAt: verified,
    },
    { id: noEmailAdmin, phone: `+9194${RUN}2`, name: "Wording Operator Two" },
    {
      id: player,
      phone: `+9194${RUN}3`,
      name: "Wording Player",
      email: PLAYER_EMAIL,
      emailVerifiedAt: verified,
    },
    {
      id: hindiPlayer,
      phone: `+9194${RUN}4`,
      name: "हिन्दी खिलाड़ी",
      email: HINDI_EMAIL,
      emailVerifiedAt: verified,
      language: "hi",
    },
  ]);
  await clearTemplates();
});

afterEach(async () => {
  operator = null;
  await clearTemplates();
});

afterAll(async () => {
  const ids = [admin, noEmailAdmin, player, hindiPlayer];
  await clearTemplates();
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("the door", () => {
  it("refuses anyone who is not a platform admin, and writes nothing", async () => {
    operator = null;
    const content = withSubject("Nope");
    expect(await publishTemplateAction("auction.unsold", "en", content)).toEqual({
      ok: false,
      error: "Not available.",
    });
    expect(await saveTemplateDraftAction("auction.unsold", "en", content)).toMatchObject({
      ok: false,
    });
    expect(await restoreTemplateVersionAction("auction.unsold", "en", 1)).toMatchObject({
      ok: false,
    });
    expect(await resetTemplateAction("auction.unsold", "en")).toMatchObject({ ok: false });
    expect(await sendTemplateTestAction("auction.unsold", "en", "default", content)).toMatchObject({
      ok: false,
    });
    expect(await previewTemplateAction("auction.unsold", "en", "default", content)).toEqual({
      ok: false,
      error: "Not available.",
    });
    expect(await adminTemplateEditor("auction.unsold")).toBeNull();
    expect(
      await db
        .select()
        .from(notificationTemplates)
        .where(eq(notificationTemplates.createdBy, admin)),
    ).toEqual([]);
  });

  it("offers no editor for a kind that sends no email, or our own staff notices", async () => {
    operator = { personId: admin };
    expect(await adminTemplateEditor("auth.phone_code")).toBeNull();
    expect(await adminTemplateEditor("staff.review_arrived")).toBeNull();
    expect(await adminTemplateEditor("nope.nothing")).toBeNull();
    expect(
      await publishTemplateAction("staff.review_arrived", "en", {
        variants: defaultContent(EMAIL_TEMPLATES["staff.review_arrived"], "en").variants,
      }),
    ).toMatchObject({ ok: false, error: "That email's wording is not editable." });
  });
});

describe("publish, restore, reset — audited, and effective in a real send", () => {
  it("a published subject goes out at once; restore and reset each do what they say", async () => {
    operator = { personId: admin };
    // Nothing published: the default.
    expect((await sendUnsold(player, "default"))[0]?.subject).toBe(`Your ${facts.season} auction`);

    const v1 = await publishTemplateAction(
      "auction.unsold",
      "en",
      withSubject("{{season}} is over — first wording"),
      "first try",
    );
    expect(v1).toMatchObject({ ok: true, version: 1 });
    expect((await sendUnsold(player, "v1"))[0]).toMatchObject({
      to: PLAYER_EMAIL,
      subject: `${facts.season} is over — first wording`,
    });

    expect(
      await publishTemplateAction("auction.unsold", "en", withSubject("{{season}} — second")),
    ).toMatchObject({ ok: true, version: 2 });
    expect((await sendUnsold(player, "v2"))[0]?.subject).toBe(`${facts.season} — second`);

    // Restore v1: a COPY, under a new number.
    expect(await restoreTemplateVersionAction("auction.unsold", "en", 1)).toMatchObject({
      ok: true,
      version: 3,
    });
    expect((await sendUnsold(player, "v3"))[0]?.subject).toBe(
      `${facts.season} is over — first wording`,
    );
    const rows = await db
      .select({ version: notificationTemplates.version, status: notificationTemplates.status })
      .from(notificationTemplates)
      .where(eq(notificationTemplates.kind, "auction.unsold"))
      .orderBy(notificationTemplates.version);
    expect(rows).toEqual([
      { version: 1, status: "archived" },
      { version: 2, status: "archived" },
      { version: 3, status: "published" },
    ]);

    // Reset: the default goes out again.
    expect(await resetTemplateAction("auction.unsold", "en")).toMatchObject({ ok: true });
    expect((await sendUnsold(player, "reset"))[0]?.subject).toBe(`Your ${facts.season} auction`);
    expect(await resetTemplateAction("auction.unsold", "en")).toMatchObject({
      ok: true,
      message: "It already uses the default wording.",
    });

    // Every step on the audit log, platform-scoped, with what it moved between.
    const published = await audits(TEMPLATE_AUDIT_ACTIONS.published);
    expect(published.map((row) => row.meta)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: 1, previousVersion: null, note: "first try" }),
        expect.objectContaining({ version: 2, previousVersion: 1 }),
      ]),
    );
    expect(
      published.every((row) => row.scopeType === "platform" && row.subject === "auction.unsold"),
    ).toBe(true);
    expect((await audits(TEMPLATE_AUDIT_ACTIONS.restored)).map((row) => row.meta)).toEqual([
      expect.objectContaining({ version: 3, previousVersion: 2, restoredFrom: 1 }),
    ]);
    expect((await audits(TEMPLATE_AUDIT_ACTIONS.reset)).map((row) => row.meta)).toEqual([
      expect.objectContaining({ version: null, previousVersion: 3 }),
    ]);

    // The editor's view tells the same story.
    const view = await adminTemplateEditor("auction.unsold");
    const en = view?.languages.find((language) => language.language === "en");
    expect(en?.status).toEqual({ state: "default" });
    expect(en?.history.map((row) => row.version)).toEqual([3, 2, 1]);
    expect(view?.changes.length).toBeGreaterThanOrEqual(4);
  });

  it("a draft is not sent; publishing promotes it under its own number", async () => {
    operator = { personId: admin };
    expect(
      await saveTemplateDraftAction("auction.unsold", "en", withSubject("Draft {{season}}")),
    ).toMatchObject({ ok: true, version: 1 });
    // Saving again edits the same draft.
    expect(
      await saveTemplateDraftAction("auction.unsold", "en", withSubject("Draft two {{season}}")),
    ).toMatchObject({ ok: true, version: 1 });
    expect((await sendUnsold(player, "draft"))[0]?.subject).toBe(`Your ${facts.season} auction`);
    expect((await wordingSummaries(db))["auction.unsold"]?.languages[0]).toMatchObject({
      status: { state: "default" },
      draft: 1,
    });
    expect(
      await publishTemplateAction("auction.unsold", "en", withSubject("Draft two {{season}}")),
    ).toMatchObject({ ok: true, version: 1 });
    expect((await sendUnsold(player, "promoted"))[0]?.subject).toBe(`Draft two ${facts.season}`);
  });

  it("refuses to publish what breaks a rule, and writes nothing", async () => {
    operator = { personId: admin };
    const lure = withSubject("Verify at https://evil.example.com/login");
    const result = await publishTemplateAction("auction.unsold", "en", lure);
    expect(result).toMatchObject({ ok: false, error: "Fix the marked parts first." });
    expect(JSON.stringify(result)).toContain("Links may only point at");
    const html = withSubject("<b>Sold</b>");
    expect(await publishTemplateAction("auction.unsold", "en", html)).toMatchObject({ ok: false });
    expect(await saveTemplateDraftAction("auction.unsold", "en", lure)).toMatchObject({
      ok: false,
    });
    expect(
      await db
        .select()
        .from(notificationTemplates)
        .where(eq(notificationTemplates.kind, "auction.unsold")),
    ).toEqual([]);
  });

  it("an invalid row in the table never blanks a mail — the default goes out", async () => {
    await db.insert(notificationTemplates).values({
      id: newId(),
      kind: "auction.unsold",
      channel: "email",
      language: "en",
      version: 1,
      status: "published",
      // Written round the writer, as a hand edit or an older rule would be.
      content: withSubject("Click https://evil.example.com"),
      createdBy: admin,
      publishedBy: admin,
      publishedAt: new Date(),
    });
    invalidateTemplates();
    expect((await sendUnsold(player, "invalid"))[0]?.subject).toBe(`Your ${facts.season} auction`);
  });
});

describe("one language per person", () => {
  it("a Hindi reader gets the Hindi default, then the published Hindi wording", async () => {
    operator = { personId: admin };
    const mailer = recordingMailer();
    await notifyEmailChanged(db, HINDI_EMAIL, "new@example.com", mailer, hindiPlayer);
    expect(mailer.sent[0]?.subject).toBe("आपका DesiAuction साइन-इन ईमेल बदल दिया गया है");
    expect(mailer.sent[0]?.text).toContain("support@desiauction.in");

    const edited = defaultContent(EMAIL_TEMPLATES["security.email_changed"], "hi");
    const fields = edited.variants["default"];
    if (fields === undefined) throw new Error("no default");
    expect(
      await publishTemplateAction("security.email_changed", "hi", {
        variants: { default: { ...fields, subject: "सावधान: आपका साइन-इन ईमेल बदला गया" } },
      }),
    ).toMatchObject({ ok: true });
    await notifyEmailChanged(db, HINDI_EMAIL, "new@example.com", mailer, hindiPlayer);
    expect(mailer.sent[1]?.subject).toBe("सावधान: आपका साइन-इन ईमेल बदला गया");
    // An English reader is untouched by the Hindi publish.
    await notifyEmailChanged(db, PLAYER_EMAIL, "new@example.com", mailer, player);
    expect(mailer.sent[2]?.subject).toBe("Your DesiAuction sign-in email was changed");
  });

  it("a Hindi reader's queued mail is written in Hindi", async () => {
    // The builders take the language the enqueuers resolve per person.
    expect((await sendUnsold(hindiPlayer, "hi", "hi"))[0]?.subject).toBe(
      `आपकी ${facts.season} नीलामी`,
    );
  });

  it("a receipt's subject follows the owner's language and the published wording", async () => {
    operator = { personId: admin };
    const compose = composeFinanceMail(db);
    const request = { templateId: "receipt.issued", body: "RECEIPT R-1\nAmount: ₹75,000" };
    expect(await compose(request, { personId: hindiPlayer })).toEqual({
      subject: "DesiAuction से आपकी रसीद",
      text: request.body,
    });
    const hi = defaultContent(EMAIL_TEMPLATES["finance.document.issued"], "hi");
    const receipt = hi.variants["receipt"];
    if (receipt === undefined) throw new Error("no default");
    expect(
      await publishTemplateAction("finance.document.issued", "hi", {
        variants: {
          ...hi.variants,
          receipt: { ...receipt, subject: "आपकी रसीद", paragraphs: ["भुगतान के लिए धन्यवाद।"] },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(await compose(request, { personId: hindiPlayer })).toEqual({
      subject: "आपकी रसीद",
      text: `भुगतान के लिए धन्यवाद।\n\n${request.body}`,
    });
    // The document is never touched, and an English owner still gets English.
    expect(await compose(request, { personId: player })).toEqual({
      subject: "Your receipt from DesiAuction",
      text: request.body,
    });
  });
});

describe("the preview and the test send", () => {
  it("previews an unsaved draft through the real renderer, with its issues", async () => {
    operator = { personId: admin };
    const preview = await previewTemplateAction(
      "auction.unsold",
      "en",
      "default",
      withSubject("Preview {{season}} <b>"),
    );
    expect(preview).toMatchObject({ ok: true, subject: "Preview Malad Premier League 2026 <b>" });
    if (!preview.ok) return;
    // Escaped by the layout, and flagged by the rules.
    expect(preview.html).toContain("<title>Not this time</title>");
    expect(preview.issues.map((issue) => issue.message)).toContain(
      "Plain text only — remove the HTML tag.",
    );
  });

  it("goes only to the operator's own verified address, prefixed [Test], and stops at ten an hour", async () => {
    const mailer = recordingMailer();
    const content = withSubject("Testing {{season}}");
    const handles = { db, auditDb: db };
    const refused = await sendTemplateTest(
      handles,
      noEmailAdmin,
      { kind: "auction.unsold", language: "en", variant: "default", content },
      { mailer },
    );
    expect(refused).toMatchObject({ ok: false });
    expect(mailer.sent).toEqual([]);

    for (let i = 0; i < TEST_SENDS_PER_HOUR; i += 1) {
      expect(
        await sendTemplateTest(
          handles,
          admin,
          { kind: "auction.unsold", language: "en", variant: "default", content },
          { mailer },
        ),
      ).toMatchObject({ ok: true });
    }
    expect(mailer.sent).toHaveLength(TEST_SENDS_PER_HOUR);
    expect(mailer.sent.every((mail) => mail.to === ADMIN_EMAIL)).toBe(true);
    expect(mailer.sent[0]?.subject).toBe("[Test] Testing Malad Premier League 2026");

    const eleventh = await sendTemplateTest(
      handles,
      admin,
      { kind: "auction.unsold", language: "en", variant: "default", content },
      { mailer },
    );
    expect(eleventh).toMatchObject({ ok: false });
    expect(mailer.sent).toHaveLength(TEST_SENDS_PER_HOUR);
    expect(await audits(TEMPLATE_AUDIT_ACTIONS.testSent)).toHaveLength(TEST_SENDS_PER_HOUR);
    // An hour on, the budget is back.
    const later = new Date(Date.now() + 61 * 60 * 1000);
    expect(
      await sendTemplateTest(
        handles,
        admin,
        { kind: "auction.unsold", language: "en", variant: "default", content },
        { mailer, now: later },
      ),
    ).toMatchObject({ ok: true });
  });

  it("refuses a test of wording that breaks a rule", async () => {
    const mailer = recordingMailer();
    expect(
      await sendTemplateTest(
        { db, auditDb: db },
        admin,
        {
          kind: "auction.unsold",
          language: "en",
          variant: "default",
          content: withSubject("See evil.co/win"),
        },
        { mailer },
      ),
    ).toMatchObject({ ok: false });
    expect(mailer.sent).toEqual([]);
  });
});

describe("the database refuses what the code refuses", () => {
  const row = (version: number, status: "published" | "draft" | "archived") => ({
    id: newId(),
    kind: "auction.unsold",
    channel: "email" as const,
    language: "en" as const,
    version,
    status,
    content: withSubject("x"),
    createdBy: admin,
    ...(status === "draft" ? {} : { publishedBy: admin, publishedAt: new Date() }),
  });

  it("one published version per kind and language", async () => {
    await db.insert(notificationTemplates).values(row(1, "published"));
    await expect(db.insert(notificationTemplates).values(row(2, "published"))).rejects.toThrow();
  });

  it("one draft, no duplicate version numbers, no unstamped publish, no unknown language", async () => {
    await db.insert(notificationTemplates).values(row(1, "draft"));
    await expect(db.insert(notificationTemplates).values(row(2, "draft"))).rejects.toThrow();
    await expect(db.insert(notificationTemplates).values(row(1, "archived"))).rejects.toThrow();
    await expect(
      db.insert(notificationTemplates).values({ ...row(3, "draft"), status: "published" }),
    ).rejects.toThrow();
    await expect(
      handle.sql`insert into notification_templates (id, kind, language, version, status, content, created_by)
        values (${newId()}, 'auction.unsold', 'fr', 9, 'draft', '{}', ${admin})`,
    ).rejects.toThrow();
    await expect(
      db
        .update(people)
        .set({ language: "fr" as "en" })
        .where(eq(people.id, player)),
    ).rejects.toThrow();
  });
});
