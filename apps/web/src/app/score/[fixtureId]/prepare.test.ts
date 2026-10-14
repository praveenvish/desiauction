import type { MatchEvent } from "@desiauction/core/scoring";
import { expect, it, vi } from "vitest";
import {
  fetchPreparedSnapshot,
  preparedHistory,
  prepareMatchDay,
  type PreparedMatch,
} from "./prepare";
const events = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => ({ seq: start + index, attempt: 1 }));
const bootstrap = {
  actorId: "scorer",
  names: { players: {}, teams: {} },
  setup: {},
  language: "en",
  sharePath: "/m/token",
  nextMatch: null,
};
it("pins a 2501-event snapshot while later same-attempt events arrive", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        preparation: "started",
        attempt: 1,
        lastSeq: 2501,
        events: events(1, 2000),
        bootstrap,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        preparation: "started",
        attempt: 1,
        lastSeq: 2503,
        events: events(2001, 2503),
      }),
    );
  const prepared = await fetchPreparedSnapshot("fixture", fetcher);
  expect(prepared?.events).toHaveLength(2501);
  expect(prepared?.events.at(-1)?.seq).toBe(2501);
  expect(fetcher.mock.calls[1]?.[0]).toBe("/api/score/fixture/events?since=2000");
});
it("discards an incomplete old-attempt snapshot after a restart", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        preparation: "started",
        attempt: 1,
        lastSeq: 2501,
        events: events(1, 2000),
        bootstrap,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ attempt: 2, lastSeq: 2502, events: events(2001, 2502) }),
    );
  expect(await fetchPreparedSnapshot("fixture", fetcher)).toBeNull();
});
it("refuses gaps and revoked permission instead of publishing partial data", async () => {
  const gap = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        preparation: "started",
        attempt: 1,
        lastSeq: 3,
        events: events(1, 1),
        bootstrap,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ preparation: "started", attempt: 1, lastSeq: 3, events: events(3, 3) }),
    );
  await expect(fetchPreparedSnapshot("fixture", gap)).rejects.toThrow("Match history changed");
  const revoked = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        preparation: "started",
        attempt: 1,
        lastSeq: 3,
        events: events(1, 1),
        bootstrap,
      }),
    )
    .mockResolvedValueOnce(Response.json({ message: "Permission revoked" }, { status: 403 }));
  await expect(fetchPreparedSnapshot("fixture", revoked)).rejects.toThrow("Permission revoked");
  expect(preparedHistory(3, events(1, 2) as MatchEvent[])).toBe(false);
});

it("accounts for all-unstarted, mixed and independently failed fixtures", async () => {
  const unstarted = {
    fixtureId: "a",
    preparation: "unstarted",
    attempt: null,
    lastSeq: 0,
    events: [],
    bootstrap,
  } as unknown as PreparedMatch;
  const all = await prepareMatchDay(["a", "b"], (id) =>
    Promise.resolve({ ...unstarted, fixtureId: id }),
  );
  expect(all.map((result) => result.status)).toEqual(["unstarted", "unstarted"]);
  const mixed = await prepareMatchDay(["a", "b", "c"], (id) =>
    id === "c"
      ? Promise.reject(new Error("Permission revoked"))
      : Promise.resolve({
          ...unstarted,
          fixtureId: id,
          preparation: id === "a" ? "started" : "unstarted",
          attempt: id === "a" ? 1 : null,
        }),
  );
  expect(mixed.map((result) => result.status)).toEqual(["ready", "unstarted", "failed"]);
  expect(mixed[2]?.message).toBe("Permission revoked");
});
it("prepares an unstarted fixture without inventing an attempt or events", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ preparation: "unstarted", attempt: null, lastSeq: 0, events: [], bootstrap }),
    );
  expect(await fetchPreparedSnapshot("fixture", fetcher)).toMatchObject({
    preparation: "unstarted",
    attempt: null,
    events: [],
    lastSeq: 0,
  });
});
