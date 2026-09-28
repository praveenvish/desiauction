import { auditLog, consentRecords, createDb, newId, people, type DbHandle } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import type { OutgoingMail, TransactionalMailer } from "../messaging/transactional-mail";
import { deletionContactOf, notifyAccountDeletion, notifyPasskeyChanged } from "./account-notices";

/**
 * THE ACCOUNT'S OWN NOTICES (email programme PR14), against a real database:
 * a passkey added or removed, and an account-deletion request at each stage —
 * to the verified email, and the last one to the address the account had.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const verified = newId();
const unverified = newId();
const EMAIL = `acct-${RUN}@example.test`;

function recording(): { mailer: TransactionalMailer; sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    mailer: {
      send: (mail) => {
        sent.push(mail);
        return Promise.resolve("sent");
      },
      deliver: (mail) => {
        sent.push(mail);
        return Promise.resolve({ outcome: "sent", providerMessageId: null });
      },
    },
  };
}

beforeAll(async () => {
  await db.insert(people).values([
    {
      id: verified,
      phone: `+9188${RUN}1`,
      name: "Arjun Sharma",
      email: EMAIL,
      emailVerifiedAt: new Date(),
    },
    { id: unverified, phone: `+9188${RUN}2`, name: "No Email", email: `x-${RUN}@example.test` },
  ]);
});

afterAll(async () => {
  const ids = [verified, unverified];
  await db.delete(auditLog).where(inArray(auditLog.scopeId, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

const context = { device: "Chrome on macOS", at: new Date("2026-09-28T14:12:00Z") };

describe("a passkey added or removed", () => {
  it("warns the verified email, with where and when, and what to do if it wasn't them", async () => {
    const { mailer, sent } = recording();
    expect(
      await notifyPasskeyChanged(
        db,
        { personId: verified, change: "added", passkeyName: "iPhone 15", context },
        mailer,
      ),
    ).toBe("sent");
    expect(sent[0]?.to).toBe(EMAIL);
    expect(sent[0]?.subject).toBe("A passkey was added to your DesiAuction account");
    expect(sent[0]?.text).toContain("“iPhone 15”");
    expect(sent[0]?.text).toContain("Chrome on macOS");
    expect(sent[0]?.text).toContain("If it wasn't you");
    expect(sent[0]?.text).toContain("/account?section=security");
    // A security notice: no switch applies, so no "Manage emails" and no unsubscribe header.
    expect(sent[0]?.headers).toBeUndefined();
  });

  it("says a removed one can no longer sign in", async () => {
    const { mailer, sent } = recording();
    await notifyPasskeyChanged(
      db,
      { personId: verified, change: "removed", passkeyName: "Old laptop" },
      mailer,
    );
    expect(sent[0]?.subject).toBe("A passkey was removed from your DesiAuction account");
  });

  it("skips an account with no verified email", async () => {
    const { mailer, sent } = recording();
    expect(
      await notifyPasskeyChanged(
        db,
        { personId: unverified, change: "added", passkeyName: "Phone" },
        mailer,
      ),
    ).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});

describe("an account-deletion request", () => {
  it("is acknowledged, with a way to stop a request the owner didn't make", async () => {
    const { mailer, sent } = recording();
    await notifyAccountDeletion(db, { personId: verified, stage: "requested" }, mailer);
    expect(sent[0]?.subject).toBe("We've received your request to delete your DesiAuction account");
    expect(sent[0]?.text).toContain("within seven days");
    expect(sent[0]?.text).toContain("Didn't ask for this?");
    // The account page's "Your data" section, where the request can be withdrawn.
    expect(sent[0]?.text).toContain("/account?section=data");
  });

  it("says withdrawn and declined plainly — the desk's reason included", async () => {
    const { mailer, sent } = recording();
    await notifyAccountDeletion(db, { personId: verified, stage: "withdrawn" }, mailer);
    await notifyAccountDeletion(
      db,
      {
        personId: verified,
        stage: "declined",
        reason: "You're the only owner of a club — appoint another owner first.",
      },
      mailer,
    );
    expect(sent.map((mail) => mail.subject)).toEqual([
      "Your DesiAuction account stays — request withdrawn",
      "We couldn't delete your DesiAuction account yet",
    ]);
    expect(sent[1]?.text).toContain("appoint another owner first");
  });

  it("sends the last mail to the address the account had before it was erased", async () => {
    const contact = await deletionContactOf(db, verified);
    await db
      .update(people)
      .set({ email: null, emailVerifiedAt: null, name: null })
      .where(eq(people.id, verified));
    const { mailer, sent } = recording();
    expect(
      await notifyAccountDeletion(db, { personId: verified, stage: "completed", contact }, mailer),
    ).toBe("sent");
    expect(sent[0]?.to).toBe(EMAIL);
    expect(sent[0]?.subject).toBe("Your DesiAuction account has been deleted");
    expect(sent[0]?.text).toContain("This is the last email we'll send to this address");
    expect(sent[0]?.text).not.toContain("/account");
  });
});
