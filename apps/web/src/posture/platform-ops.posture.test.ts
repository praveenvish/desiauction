/**
 * RUNTIME POSTURE — the admin write door (`server/platform-ops`, AC-1.1),
 * under the production roles.
 *
 * Every admin writer starts at `operatorFor`: a platform grant carrying the
 * capability, a step-up code entered on THIS session in the last ten minutes,
 * and a written reason. This suite proves each refusal and the one way
 * through, on `desiauction_app` exactly as production runs it — and that a
 * step-up code is good for nothing else: it cannot sign anybody in, and it
 * does not travel to a second session. It is also the TEMPLATE the AC-1
 * writers copy: seed as the owner, act as the app role, assert on rows.
 */
import { createHash, randomBytes } from "node:crypto";

import { createDb, grants, newId, otpInbox, sessions } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "da_session" && sessionToken !== "" ? { value: sessionToken } : undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

const { operatorFor } = await import("../server/platform-ops/guard");
const { requestStepUpCode, confirmStepUpCode } = await import("../server/auth/step-up");
const { verifyOtp } = await import("../server/auth/otp");
const { DevInboxSender } = await import("../server/auth/otp-sender");
const { db } = await import("../server/db");

const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;

const RUN = String(Date.now()).slice(-7);
// A valid 10-digit Indian mobile: 9, six digits of the run, three of the person.
const phoneOf = (n: number): string => `+919${RUN.slice(-6)}${String(n).padStart(3, "0")}`;
const people: string[] = [];
let superadmin = "";
let supportOnly = "";
let stranger = "";
let sessionId = "";
let stepUpCode = "";

async function person(name: string, n: number): Promise<string> {
  const id = newId();
  await ownerHandle.sql`insert into people (id, name, phone) values (${id}, ${name}, ${phoneOf(n)})`;
  people.push(id);
  return id;
}

async function grant(personId: string, set: string): Promise<void> {
  await owner.insert(grants).values({
    id: newId(),
    personId,
    scopeType: "platform",
    scopeId: "00000000000000000000000000",
    capabilitySet: set,
    grantedBy: personId,
  });
}

/** A session as an OLD one: signed in long ago, never stepped up. */
async function signIn(personId: string): Promise<string> {
  sessionToken = randomBytes(32).toString("base64url");
  const id = newId();
  await owner.insert(sessions).values({
    id,
    personId,
    tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    steppedUpAt: null,
  });
  return id;
}

async function latestCode(phone: string): Promise<string> {
  const [row] = await owner
    .select({ code: otpInbox.code })
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  if (row === undefined) {
    throw new Error("no code delivered");
  }
  return row.code;
}

beforeAll(async () => {
  superadmin = await person("Super Admin", 1);
  supportOnly = await person("Support Desk", 2);
  stranger = await person("Stranger", 3);
  await grant(superadmin, "platform:superadmin");
  await grant(supportOnly, "platform:support");
});

afterAll(async () => {
  for (const id of people) {
    await ownerHandle.sql`delete from grants where person_id = ${id}`;
    await ownerHandle.sql`delete from sessions where person_id = ${id}`;
    await ownerHandle.sql`delete from audit_log where actor = ${id}`;
  }
  for (const n of [1, 2, 3]) {
    await ownerHandle.sql`delete from otp_inbox where phone = ${phoneOf(n)}`;
    await ownerHandle.sql`delete from otp_codes where phone = ${phoneOf(n)}`;
  }
  for (const id of people) {
    await ownerHandle.sql`delete from people where id = ${id}`;
  }
  await ownerHandle.sql.end();
});

const REASON = "Testing the admin door under production roles";

describe("the admin write door under the production roles", () => {
  it("refuses anyone without the capability, whatever else they hold", async () => {
    await signIn(stranger);
    expect(await operatorFor("platform.grant", { reason: REASON })).toMatchObject({ ok: false });
    await signIn(supportOnly);
    const refused = await operatorFor("platform.grant", { reason: REASON });
    // Refused outright — not asked to confirm: no code would help them.
    expect(refused).toMatchObject({ ok: false });
    expect(refused).not.toMatchObject({ stepUp: true });
  });

  it("asks a superadmin for a reason, then to confirm it's them", async () => {
    sessionId = await signIn(superadmin);
    expect(await operatorFor("platform.grant", { reason: "short" })).toMatchObject({
      ok: false,
    });
    expect(await operatorFor("platform.grant", { reason: REASON })).toMatchObject({
      ok: false,
      stepUp: true,
    });
  });

  it("a step-up code never signs anybody in", async () => {
    const sender = new DevInboxSender(db);
    const sent = await requestStepUpCode(db, sender, { personId: superadmin, requestIp: null });
    expect(sent).toMatchObject({ ok: true, mail: null });
    stepUpCode = await latestCode(phoneOf(1));
    // The sign-in path looks only at sign-in codes: this one is invisible to it.
    expect((await verifyOtp(db, phoneOf(1), stepUpCode)).ok).toBe(false);
  });

  it("the right code opens the door for this session, on desiauction_app", async () => {
    // The same code the sign-in path refused: still unspent, and good here.
    expect(
      await confirmStepUpCode(db, { personId: superadmin, sessionId, code: stepUpCode }),
    ).toMatchObject({ ok: true });
    const opened = await operatorFor("platform.grant", { reason: REASON });
    expect(opened).toMatchObject({ ok: true, operator: { personId: superadmin, reason: REASON } });
  });

  it("a second session of the same person is not stepped up by the first", async () => {
    await signIn(superadmin);
    expect(await operatorFor("platform.grant", { reason: REASON })).toMatchObject({
      ok: false,
      stepUp: true,
    });
  });
});
