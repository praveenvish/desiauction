/**
 * RUNTIME POSTURE — a club's "don't send" switch, as the outbox drain meets it.
 *
 * Gate finding P1-4. The drain runs across every org on the bare app pool, and
 * the send gate it calls reads `org_messaging_settings` — FORCE ROW LEVEL
 * SECURITY, visible only where `app.org_id` names its club. With no org set the
 * policy hides the row, and `maySend` reads "no row" as "enabled". So a club
 * that switched auction messages off kept sending them, in production only:
 * every other suite runs as the database owner, whom RLS does not apply to, and
 * there the switch worked perfectly.
 *
 * The assertion is on DATA — the row must end suppressed with the club's reason
 * and the provider must never be called — because a read that loses its
 * boundary does not throw, it just sees nothing.
 */
import { createDb, newId } from "@desiauction/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OutgoingMail, TransactionalMailer } from "../server/messaging/transactional-mail";

// Fixtures run as the OWNER; only the drain under test runs as the app role.
const owner = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const { drainOutbox, enqueueMail } = await import("../server/messaging/outbox");

const RUN = String(Date.now()).slice(-7);
const person = newId();
const orgId = newId();
const openOrg = newId();

beforeAll(async () => {
  await owner.sql`
    insert into people (id, phone, name, email, email_verified_at)
    values (${person}, ${`+9196${RUN}1`}, 'Posture Outbox', ${`posture-outbox-${RUN}@example.test`}, now())
  `;
  // The club said no to auction mail. The other club never opened the screen.
  await owner.sql`
    insert into org_messaging_settings (id, org_id, topic, channel, enabled)
    values (${newId()}, ${orgId}, 'auction', 'email', false)
  `;
});

afterAll(async () => {
  await owner.sql`delete from message_outbox where person_id = ${person}`;
  await owner.sql`delete from org_messaging_settings where org_id = ${orgId}`;
  await owner.sql`delete from people where id = ${person}`;
  await owner.sql.end();
});

function recorder(): TransactionalMailer & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve("sent");
    },
  };
}

describe("POSTURE — the outbox drain honours a club's switch as desiauction_app (P1-4)", () => {
  it("suppresses a club's message once the club has switched the topic off", async () => {
    // Queued through the app pool, as the moment's own action would.
    await enqueueMail([
      {
        personId: person,
        orgId,
        kind: "auction.sold",
        dedupeKey: `posture:${RUN}:club-off`,
        subject: "Sold",
        text: "You were bought.",
        html: "<p>You were bought.</p>",
      },
    ]);
    const provider = recorder();
    const result = await drainOutbox({ mailer: provider, personIds: [person] });
    expect(provider.sent, "the club's switch was not seen — the read ran outside its org").toEqual(
      [],
    );
    expect(result.suppressed).toBe(1);
    const rows = (await owner.sql`
      select status, last_error from message_outbox where dedupe_key = ${`posture:${RUN}:club-off`}
    `) as unknown as { status: string; last_error: string | null }[];
    expect(rows[0]).toEqual({ status: "suppressed", last_error: "org_disabled" });
  });

  it("still sends for a club that never switched anything off — the scope does not over-suppress", async () => {
    await enqueueMail([
      {
        personId: person,
        orgId: openOrg,
        kind: "auction.sold",
        dedupeKey: `posture:${RUN}:club-on`,
        subject: "Sold",
        text: "You were bought.",
        html: "<p>You were bought.</p>",
      },
    ]);
    const provider = recorder();
    const result = await drainOutbox({ mailer: provider, personIds: [person] });
    expect(result.sent).toBe(1);
    expect(provider.sent[0]?.to).toBe(`posture-outbox-${RUN}@example.test`);
  });
});
