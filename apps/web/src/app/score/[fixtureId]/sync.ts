import type { MatchEvent } from "@desiauction/core/scoring";
import type { EventAck } from "../../../server/scoring/append";
import { queueBatch, type QueueItem } from "./queue";

export interface SyncReply {
  acks: EventAck[];
  events: MatchEvent[];
  attempt: number;
  lastSeq: number;
}
import { SyncRefusal } from "./sync-refusal";
import { readHistory } from "./history";
export { SyncRefusal } from "./sync-refusal";
export { readHistory } from "./history";
export const retryDelay = (failures: number) => Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));

export async function sendBatch(
  fixtureId: string,
  deviceId: string,
  attempt: number,
  items: readonly QueueItem[],
  keepalive = false,
  fetcher: typeof fetch = fetch,
): Promise<SyncReply> {
  const batch = queueBatch(items);
  const response = await fetcher(`/api/score/${fixtureId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive,
    body: JSON.stringify({
      deviceId,
      attempt,
      events: batch.map(({ event }) => {
        return {
          eventId: event.eventId,
          attempt: event.attempt,
          type: event.type,
          v: event.v,
          payload: event.payload,
          targetEventId: event.targetEventId,
          clientSeq: event.clientSeq,
          clientRecordedAt: event.clientRecordedAt,
        };
      }),
    }),
  });
  const body = (await response.json()) as { acks?: EventAck[]; message?: string };
  if (!response.ok || !body.acks) {
    if (response.status >= 500 || response.status === 429)
      throw new Error(body.message ?? "Could not send balls.");
    throw new SyncRefusal(
      body.message ?? "This phone cannot send scoring entries.",
      batch.map((item) => item.event.eventId),
    );
  }
  // Refresh authoritative history, including another device's accepted entries.
  return { acks: body.acks, ...(await readHistory(fixtureId, fetcher)) };
}

export interface SyncSource {
  batch(): Promise<{ items: QueueItem[]; deviceId: string; attempt: number } | null>;
  received(reply: SyncReply): Promise<void>;
  failed(message: string, permanent: boolean, rejectedIds?: readonly string[]): void;
}
/** One in-flight batch, durable before transmission; duplicates recover lost replies. */
export function startSync(
  fixtureId: string,
  source: SyncSource,
  target: Window = window,
  fetcher: typeof fetch = fetch,
) {
  let running = false,
    stopped = false,
    failures = 0,
    blocked = false;
  const isStopped = () => stopped;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function flush(keepalive = false) {
    if (running || stopped || blocked || !target.navigator.onLine) return;
    running = true;
    try {
      const batch = await source.batch();
      if (isStopped() || !batch || batch.items.length === 0) return;
      const reply = await sendBatch(
        fixtureId,
        batch.deviceId,
        batch.attempt,
        batch.items,
        keepalive,
        fetcher,
      );
      if (isStopped()) return;
      await source.received(reply);
      failures = 0;
      timer = setTimeout(() => {
        void flush();
      }, 0);
    } catch (error) {
      if (isStopped()) return;
      const permanent = error instanceof SyncRefusal;
      source.failed(
        error instanceof Error ? error.message : "Could not send balls.",
        permanent,
        error instanceof SyncRefusal ? error.rejectedIds : [],
      );
      blocked = permanent;
      if (!permanent)
        timer = setTimeout(() => {
          void flush();
        }, retryDelay(failures++));
    } finally {
      running = false;
    }
  }
  const online = () => {
    if (timer) clearTimeout(timer);
    void flush();
  };
  const visible = () => {
    if (target.document.visibilityState === "visible") online();
  };
  const leave = () => {
    void flush(true);
  };
  target.addEventListener("online", online);
  target.document.addEventListener("visibilitychange", visible);
  target.addEventListener("pagehide", leave);
  return {
    flush,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      target.removeEventListener("online", online);
      target.document.removeEventListener("visibilitychange", visible);
      target.removeEventListener("pagehide", leave);
    },
  };
}
