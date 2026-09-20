import { createHash, randomBytes } from "node:crypto";

import { createDb, newId, otpCodes, otpInbox, people, sessions } from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * THE ACTION PAIR, AS THE FORMS CALL IT.
 *
 * `phone-change.regression.test.ts` proves the domain functions. This proves
 * the two server actions the way both forms (/account and the register page's
 * "Mobile" step) wire them: two separate `useActionState`s, so the CONFIRM
 * action's `previous` is its own initial `{ step: "idle" }` and has never seen
 * the number the REQUEST accepted. That shape failed on the first try every
 * time — "Start again — that number could not be read" — which left an
 * email-only account (0062) unable to attach a phone at all, and so unable to
 * register as a player.
 */

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name.endsWith("da_session") && sessionToken !== "" ? { value: sessionToken } : undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { env } = await import("../../env");
const { confirmPhoneChangeAction, requestPhoneChangeAction } = await import("./actions");

const handle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const FIRST = `+9197${RUN}1`;
const SECOND = `+9197${RUN}2`;
const ADDRESS = `attach${RUN}@example.test`;
const personId = newId();

async function mailedCode(phone: string): Promise<string> {
  const [row] = await db
    .select({ code: otpInbox.code })
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  if (row === undefined) {
    throw new Error(`no code was sent to ${phone}`);
  }
  return row.code;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

beforeAll(async () => {
  await db.delete(otpCodes).where(inArray(otpCodes.phone, [FIRST, SECOND]));
  await db.insert(people).values({ id: personId, email: ADDRESS, name: "Attach Synthetic" });
  sessionToken = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    id: newId(),
    personId,
    tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
});

afterAll(async () => {
  await db.delete(otpCodes).where(inArray(otpCodes.phone, [FIRST, SECOND]));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, [FIRST, SECOND]));
  await db.delete(sessions).where(eq(sessions.personId, personId));
  await db.delete(people).where(eq(people.id, personId));
  await handle.sql.end({ timeout: 5 });
});

describe("attaching a first number through the two actions", () => {
  it("confirms from a fresh confirm state, reading the number the form carries", async () => {
    const requested = await requestPhoneChangeAction(
      { step: "idle" },
      form({ phone: FIRST.slice(3) }),
    );
    expect(requested).toEqual({ step: "code", phone: FIRST });

    // Exactly what the confirm form sends: its own untouched initial state,
    // the typed code, and the requested number in a hidden field.
    const confirmed = await confirmPhoneChangeAction(
      { step: "idle" },
      form({ code: await mailedCode(FIRST), phone: requested.phone ?? "" }),
    );
    expect(confirmed).toEqual({ step: "idle", done: true });
    const [row] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, personId));
    expect(row?.phone).toBe(FIRST);
  });

  it("confirms the number now in the form, not one a stale state remembers", async () => {
    // "Use a different number": the confirm state still holds the first number
    // from an earlier failed try, and the form now carries the second.
    const requested = await requestPhoneChangeAction(
      { step: "idle" },
      form({ phone: SECOND.slice(3) }),
    );
    expect(requested.phone).toBe(SECOND);
    const confirmed = await confirmPhoneChangeAction(
      { step: "code", phone: FIRST },
      form({ code: await mailedCode(SECOND), phone: SECOND }),
    );
    expect(confirmed.done).toBe(true);
    const [row] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, personId));
    expect(row?.phone).toBe(SECOND);
  });
});
