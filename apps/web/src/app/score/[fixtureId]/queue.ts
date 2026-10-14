import { scoringRead, scoringWrite, scoringUpdate, onScoringStop } from "../storage";
import type { PreparedMatch } from "./prepare";
import type { MatchEvent } from "@desiauction/core/scoring";

export interface QueueItem {
  event: MatchEvent;
  status: "pending" | "sending";
  groupId?: string;
  groupOrder?: number;
}
const writes = new Map<string, Promise<void>>();
if (typeof window !== "undefined")
  onScoringStop(() => {
    writes.clear();
  });
export const queueKey = (fixtureId: string) => `ls1:queue:${fixtureId}`;

/** Upgrade setup's device identity without changing its existing match claim. */
export async function scoringDevice(): Promise<string> {
  const previous = localStorage.getItem("ls1:device");
  const candidate = previous || crypto.randomUUID();
  const device = await scoringUpdate<string>("ls1:device", (stored) => stored || candidate);
  if (!device) throw new Error("Scoring device could not be saved.");
  localStorage.setItem("ls1:device", device);
  return device;
}
export async function loadQueue(fixtureId: string): Promise<QueueItem[]> {
  await writes.get(fixtureId);
  return (await scoringRead<QueueItem[]>(queueKey(fixtureId))) ?? [];
}
/** Serialize snapshots so a slower earlier write cannot resurrect an undone ball. */
export function saveQueue(
  fixtureId: string,
  items: readonly QueueItem[],
  history?: readonly MatchEvent[],
  bootstrap?: PreparedMatch["bootstrap"],
  scoringReady?: boolean,
): Promise<void> {
  const canonical = history ? [...history] : undefined;
  const snapshot = items.map((item) => ({ ...item }));
  const next = (writes.get(fixtureId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      scoringWrite(
        [[queueKey(fixtureId), snapshot]],
        canonical
          ? {
              key: `ls1:prepared:${fixtureId}`,
              update: (value) => {
                const prepared = value as PreparedMatch;
                const last = canonical.at(-1);
                return {
                  ...prepared,
                  ...(bootstrap ? { bootstrap } : {}),
                  preparation:
                    scoringReady === undefined
                      ? prepared.preparation
                      : scoringReady
                        ? "started"
                        : "unstarted",
                  events: canonical,
                  lastSeq: last?.seq ?? 0,
                  attempt: last
                    ? last.attempt + (last.type === "restart" ? 1 : 0)
                    : prepared.attempt,
                };
              },
            }
          : undefined,
      ),
    );
  writes.set(fixtureId, next);
  return next;
}

/** A logical scoring operation must fit wholly into one API request. */
export function queueBatch(items: readonly QueueItem[]): QueueItem[] {
  const anotherAttempt = items.findIndex((item) => item.event.attempt !== items[0]?.event.attempt);
  let end = Math.min(50, anotherAttempt > 0 ? anotherAttempt : items.length);
  const next = items[end];
  if (next?.groupId) {
    while (end > 0 && items[end - 1]?.groupId === next.groupId) end--;
  }
  if (end === 0 && items.length > 0) throw new Error("Scoring group exceeds the request limit.");
  return items.slice(0, end);
}
