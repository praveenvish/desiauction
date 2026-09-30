// Against real Postgres: the ceilings on invitation mail are counted from the
// audit rows the invite actions write, across clubs, and hold under parallel
// requests (PRR 2026-09-29).
import { auditLog, createDb, newId, type Db, type DbHandle } from "@desiauction/db";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  INVITE_MAILS_PER_INVITE,
  INVITE_MAILS_PER_PERSON_PER_HOUR,
  claimInviteMailBudget,
} from "./invite-mail-budget";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const actors: string[] = [];
function actor(): string {
  const id = newId();
  actors.push(id);
  return id;
}

/** What the invite actions do: claim, (send), record — in one transaction. */
async function send(
  who: string,
  orgId: string,
  inviteId: string,
  action: "invite.emailed" | "auction.owner_invite_emailed" = "invite.emailed",
  hold?: Promise<void>,
): Promise<string> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const budget = await claimInviteMailBudget(tx, db, { actor: who, orgId, inviteId });
    if (budget !== "ok") {
      return budget;
    }
    await hold; // the provider call
    await tx.insert(auditLog).values({
      id: newId(),
      actor: who,
      action,
      scopeType: "org",
      scopeId: orgId,
      subject: inviteId,
      meta: {},
    });
    return "ok";
  });
}

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.actor, actors));
  await handle.sql.end();
});

describe("the ceilings on invitation mail", () => {
  it("one invite is mailed five times and no more, whoever it is addressed to", async () => {
    const who = actor();
    const orgId = newId();
    const inviteId = newId();
    for (let i = 0; i < INVITE_MAILS_PER_INVITE; i++) {
      expect(await send(who, orgId, inviteId)).toBe("ok");
    }
    expect(await send(who, orgId, inviteId)).toBe("invite-limit");
    // A different invite in the same club is its own count.
    expect(await send(who, orgId, newId())).toBe("ok");
  });

  it("one person's hourly ceiling holds ACROSS clubs and both kinds of invite", async () => {
    const who = actor();
    for (let i = 0; i < INVITE_MAILS_PER_PERSON_PER_HOUR; i++) {
      // A new club and a new invite every time: what the abuse looks like.
      const kind = i % 2 === 0 ? "invite.emailed" : "auction.owner_invite_emailed";
      expect(await send(who, newId(), newId(), kind)).toBe("ok");
    }
    expect(await send(who, newId(), newId())).toBe("person-limit");
    // Somebody else is not affected.
    expect(await send(actor(), newId(), newId())).toBe("ok");
  });

  it("refuses a second send while the first is in flight, rather than queueing it", async () => {
    const who = actor();
    const orgId = newId();
    let release: () => void = () => undefined;
    const provider = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = send(who, orgId, newId(), "invite.emailed", provider);
    // Give the first its lock, then knock while it is still sending.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await send(who, orgId, newId())).toBe("busy");
    release();
    expect(await first).toBe("ok");
    expect(await send(who, orgId, newId())).toBe("ok");
  });
});
