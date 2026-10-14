import { expect, it } from "vitest";
import { queueBatch, type QueueItem } from "./queue";
import type { MatchEvent } from "@desiauction/core/scoring";
const item = (id: string, groupId?: string, groupOrder?: number): QueueItem => ({
  event: { eventId: id } as MatchEvent,
  status: "pending",
  ...(groupId ? { groupId, groupOrder: groupOrder ?? 0 } : {}),
});
it("flushes 49 earlier entries before a two-event group at the request boundary", () => {
  const earlier = Array.from({ length: 49 }, (_, i) => item(String(i)));
  const group = [item("wicket", "pair", 0), item("replacement", "pair", 1)];
  expect(queueBatch([...earlier, ...group])).toEqual(earlier);
  expect(queueBatch(group)).toEqual(group);
  expect(queueBatch(Array.from({ length: 51 }, (_, i) => item(String(i))))).toHaveLength(50);
});
it("never silently truncates an oversized restored group", () => {
  expect(() =>
    queueBatch(Array.from({ length: 51 }, (_, i) => item(String(i), "oversized", i))),
  ).toThrow("request limit");
});
it("keeps distinct attempts in ordered requests", () => {
  const restart = { ...item("restart"), event: { ...item("restart").event, attempt: 1 } };
  const start = { ...item("start"), event: { ...item("start").event, attempt: 2 } };
  expect(queueBatch([restart, start])).toEqual([restart]);
});
