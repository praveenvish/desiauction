import { createHash } from "node:crypto";

import { createDb, demoBookings, demoRequests, newId } from "@desiauction/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { demoQueue } from "./demo-views";

const handle = createDb(env.DATABASE_URL, { max: 1 });
const requestIds = [newId(), newId(), newId()];
const bookingIds = [newId(), newId()];
const future = new Date("2099-10-13T12:27:00.000Z");

beforeAll(async () => {
  await handle.db.insert(demoRequests).values(
    requestIds.map((id) => ({
      id,
      name: "Synthetic demo queue timestamp regression",
      phone: "+919999001413",
      orgName: "Synthetic timestamp review",
      tournamentSize: "8-16" as const,
      preferredWindow: "any" as const,
      source: "schedule-demo" as const,
      // Keep these exact-owned rows inside the recent projection, independent
      // of existing lab data. This is fixture time, never the production clock.
      createdAt: future,
    })),
  );
  await handle.db.insert(demoBookings).values(
    bookingIds.map((id, index) => {
      const demoRequestId = requestIds[index];
      if (demoRequestId === undefined) throw new Error("Missing owned request fixture");
      return {
        id,
        demoRequestId,
        slotStart: new Date(future.getTime() + index * 3_600_000),
        slotEnd: new Date(future.getTime() + index * 3_600_000 + 1_800_000),
        tokenHash: createHash("sha256").update(id).digest("hex"),
        ...(index === 1 ? { cancelledAt: new Date(), cancelledBy: "requester" as const } : {}),
      };
    }),
  );
});

afterAll(async () => {
  await handle.db.delete(demoBookings).where(inArray(demoBookings.id, bookingIds));
  await handle.db.delete(demoRequests).where(inArray(demoRequests.id, requestIds));
  await handle.sql.end();
});

describe("populated demo queue timestamp decoding", () => {
  it("returns a real Date and includes the live future booking in upcoming", async () => {
    const queue = await demoQueue();
    const row = queue.open.find((entry) => entry.id === requestIds[0]);
    expect(row?.slotStart).toBeInstanceOf(Date);
    expect(row?.slotStart?.toISOString()).toBe(future.toISOString());
    expect(queue.upcoming.some((entry) => entry.id === requestIds[0])).toBe(true);
  });

  it("keeps cancelled and absent bookings unarranged rather than inventing a date", async () => {
    const queue = await demoQueue();
    for (const id of requestIds.slice(1)) {
      expect(queue.open.find((entry) => entry.id === id)?.slotStart).toBeNull();
      expect(queue.upcoming.some((entry) => entry.id === id)).toBe(false);
    }
  });
});
