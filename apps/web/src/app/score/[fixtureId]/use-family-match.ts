"use client";
import { useEffect, useRef, useState } from "react";
import {
  type MatchEvent,
  type MatchState,
  type EventType,
  type PayloadOf,
  type RejectReason,
} from "@desiauction/core/scoring";
import { REJECT_MESSAGES } from "@desiauction/core/scoring/messages";
import { ReplayError } from "@desiauction/core/scoring/replay-error";
import { scoringEventId } from "./setup/setup-model";
import { loadQueue, saveQueue, scoringDevice, queueBatch, type QueueItem } from "./queue";
import type { PreparedMatch } from "./prepare";
import { bindScoringActor, onScoringStop } from "../storage";
import type { LocalEntry, FamilyLocalEntry } from "./local-entry";
import { startSync, readHistory, type SyncReply } from "./sync";

export type LocalState = { attempt: number; lastSeq: number; finished: boolean };
export interface MatchView<S extends LocalState = MatchState> {
  state: S;
  pending: number;
  error: string | null;
  offline: boolean;
  ready: boolean;
  setupAccepted: boolean;
}
export type { LocalEntry } from "./local-entry";
export type Persist = (
  items: readonly QueueItem[],
  history: readonly MatchEvent[],
  scoringReady: boolean,
) => Promise<void>;
export interface LocalPolicy<S extends LocalState> {
  replay(events: readonly MatchEvent[]): S;
  accepted(events: readonly MatchEvent[], attempt: number): boolean;
  scoringReady(state: S): boolean;
  undoTypes: readonly EventType[];
  refusal(reason: RejectReason): string;
}
export class LocalMatchModel<S extends LocalState> {
  items: QueueItem[] = [];
  history: MatchEvent[];
  deviceId = "";
  ready = false;
  offline = false;
  error: string | null = null;
  private sequence: number;
  private durable = Promise.resolve();
  constructor(
    readonly fixtureId: string,
    readonly actorId: string,
    history: MatchEvent[],
    private persist: Persist,
    private changed: (view: MatchView<S>) => void,
    private policy: LocalPolicy<S>,
  ) {
    this.history = history;
    this.sequence = Math.max(
      0,
      ...history.filter((e) => e.actorPersonId === actorId).map((e) => e.clientSeq),
    );
  }
  events(): MatchEvent[] {
    const base = Math.max(0, ...this.history.map((e) => e.seq));
    return [
      ...this.history,
      ...this.items.map(({ event }, i) => ({ ...event, seq: base + i + 1 })),
    ];
  }
  view(): MatchView<S> {
    const state = this.policy.replay(this.events());
    return {
      state,
      setupAccepted: this.policy.accepted(this.history, state.attempt),
      pending: this.items.length,
      error: this.error,
      offline: this.offline,
      ready: this.ready,
    };
  }
  publish() {
    this.changed(this.view());
  }
  private save() {
    const canonical = this.policy.replay(this.history);
    this.durable = this.persist(this.items, this.history, this.policy.scoringReady(canonical));
    void this.durable.catch(() => {
      this.error =
        "This phone could not save the scoring queue. Keep this page open and try again.";
      this.offline = true;
      this.publish();
    });
  }
  restore(items: QueueItem[], deviceId: string) {
    if (items.some((item) => item.event.actorPersonId !== this.actorId)) {
      this.error =
        "These saved balls belong to another scorer. Sign in as that scorer to send them.";
      this.publish();
      return;
    }
    const existing = new Set(this.history.map((e) => e.eventId));
    const attempt = this.policy.replay(this.history).attempt;
    this.items = items.filter((i) => !existing.has(i.event.eventId) && i.event.attempt === attempt);
    if (items.some((i) => !existing.has(i.event.eventId) && i.event.attempt !== attempt))
      this.error = REJECT_MESSAGES.wrong_attempt;
    this.deviceId = deviceId;
    this.sequence = Math.max(this.sequence, ...items.map((i) => i.event.clientSeq));
    this.reconcile();
    this.ready = true;
    this.publish();
    this.save();
  }
  private reconcile() {
    const valid: QueueItem[] = [];
    for (const item of this.items) {
      try {
        const seq = Math.max(0, ...this.history.map((e) => e.seq)) + valid.length + 1;
        this.policy.replay([
          ...this.history,
          ...valid.map((entry, index) => ({ ...entry.event, seq: seq - valid.length + index })),
          { ...item.event, seq },
        ]);
        valid.push(item);
      } catch (error) {
        this.error =
          error instanceof ReplayError
            ? this.policy.refusal(error.reason)
            : "Reload to check the scoring entries.";
      }
    }
    this.items = valid;
  }
  preview(entries: readonly FamilyLocalEntry[]): S {
    return this.policy.replay([...this.events(), ...this.propose(entries)]);
  }
  private propose(entries: readonly FamilyLocalEntry[]): MatchEvent[] {
    const state = this.view().state;
    return entries.map((entry, index) => ({
      eventId: scoringEventId(),
      ...entry,
      targetEventId: entry.targetEventId ?? null,
      v: 1,
      attempt: state.attempt,
      actorPersonId: this.actorId,
      clientSeq: this.sequence + index + 1,
      clientRecordedAt: new Date().toISOString(),
      seq: state.lastSeq + index + 1,
    }));
  }
  applyBatch(entries: readonly FamilyLocalEntry[]): string[] | null {
    if (!this.ready || entries.length === 0 || entries.length > 50) return null;
    const events = this.propose(entries);
    try {
      this.policy.replay([...this.events(), ...events]);
    } catch (error) {
      this.error =
        error instanceof ReplayError
          ? this.policy.refusal(error.reason)
          : "Check the scoring entry.";
      this.publish();
      return null;
    }
    const groupId = events[0]?.eventId;
    this.sequence += events.length;
    this.items = [
      ...this.items,
      ...events.map((event, groupOrder): QueueItem => ({
        event,
        status: "pending",
        ...(groupId ? { groupId, groupOrder } : {}),
      })),
    ];
    this.publish();
    this.save();
    return events.map((event) => event.eventId);
  }
  apply<T extends EventType>(
    type: T,
    payload: PayloadOf<T>,
    targetEventId: string | null = null,
  ): string | null {
    return this.applyBatch([{ type, payload, targetEventId } as LocalEntry])?.[0] ?? null;
  }
  undo(eventId?: string): boolean {
    const voided = new Set(
      this.events()
        .filter((event) => event.type === "void")
        .map((event) => event.targetEventId),
    );
    const event = eventId
      ? this.events().find((e) => e.eventId === eventId)
      : this.events().findLast(
          (e) =>
            e.actorPersonId === this.actorId &&
            this.policy.undoTypes.includes(e.type) &&
            !voided.has(e.eventId),
        );
    if (!event || event.actorPersonId !== this.actorId) return false;
    const item = this.items.find((i) => i.event.eventId === event.eventId);
    if (item?.status === "pending") {
      this.items = this.items.filter((i) => i.event.eventId !== event.eventId);
      this.reconcile();
      this.publish();
      this.save();
      return true;
    }
    return this.apply("void", {}, event.eventId) !== null;
  }
  whenDurable() {
    return this.durable;
  }
  async batch() {
    await this.durable;
    if (!this.ready || this.items.length === 0) return null;
    const items = queueBatch(this.items);
    const ids = new Set(items.map((i) => i.event.eventId));
    this.items = this.items.map((item) =>
      ids.has(item.event.eventId) ? { ...item, status: "sending" } : item,
    );
    this.save();
    await this.durable;
    return {
      items,
      deviceId: this.deviceId,
      attempt: items[0]?.event.attempt ?? this.view().state.attempt,
    };
  }
  async received(reply: SyncReply) {
    const acked = new Set(reply.acks.map((a) => a.eventId));
    const present = new Set(reply.events.map((e) => e.eventId));
    this.history = reply.events;
    this.items = this.items.filter(
      (i) => !acked.has(i.event.eventId) && !present.has(i.event.eventId),
    );
    const rejected = reply.acks.find((a) => a.status === "rejected");
    this.error =
      rejected?.message ?? (rejected?.reason ? this.policy.refusal(rejected.reason) : null);
    if (this.items.some((i) => i.event.attempt !== reply.attempt)) {
      this.items = this.items.filter((i) => i.event.attempt === reply.attempt);
      this.error = REJECT_MESSAGES.wrong_attempt;
    }
    this.reconcile();
    this.offline = false;
    this.publish();
    this.save();
    await this.durable;
  }
  failed(message: string, permanent: boolean, rejectedIds: readonly string[] = []) {
    this.offline = true;
    if (permanent) {
      this.items = this.items.filter((item) => !rejectedIds.includes(item.event.eventId));
      this.reconcile();
      this.error = message;
      this.save();
    }
    this.publish();
  }
  resumeAfterTakeover(history: MatchEvent[]) {
    if (this.items.length) throw new Error("Send or review saved balls before taking over.");
    this.policy.replay(history);
    this.history = history;
    this.sequence = Math.max(
      this.sequence,
      0,
      ...history
        .filter((event) => event.actorPersonId === this.actorId)
        .map((event) => event.clientSeq),
    );
    this.ready = true;
    this.offline = false;
    this.error = null;
    this.publish();
    this.save();
  }
  dismissError() {
    this.error = null;
    this.publish();
  }
}
export function useFamilyMatch<S extends LocalState>(
  fixtureId: string,
  actorId: string,
  events: MatchEvent[],
  bootstrap: PreparedMatch["bootstrap"] | undefined,
  policy: LocalPolicy<S>,
) {
  const [view, setView] = useState<MatchView<S>>(() => ({
    state: policy.replay(events),
    pending: 0,
    error: null,
    offline: false,
    ready: false,
    setupAccepted: policy.accepted(events, policy.replay(events).attempt),
  }));
  const model = useRef<LocalMatchModel<S> | null>(null);
  const sender = useRef<ReturnType<typeof startSync> | null>(null);
  if (!model.current)
    model.current = new LocalMatchModel(
      fixtureId,
      actorId,
      events,
      (items, history, scoringReady) =>
        saveQueue(fixtureId, items, history, bootstrap, scoringReady),
      setView,
      policy,
    );
  useEffect(() => {
    const current = model.current;
    if (!current) return;
    let active = true;
    const connection = () => {
      current.offline = !navigator.onLine;
      current.publish();
    };
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    let unwatch = () => {};
    void bindScoringActor(actorId)
      .then(() => {
        unwatch = onScoringStop(() => {
          active = false;
          current.ready = false;
          sender.current?.stop();
          current.error = "Signed out. Sign in again to score.";
          current.publish();
        });
        return Promise.all([loadQueue(fixtureId), scoringDevice()]);
      })
      .then(([items, device]) => {
        if (!active) return;
        current.offline = !navigator.onLine;
        current.restore(items, device);
        sender.current = startSync(fixtureId, current);
        void sender.current.flush();
      })
      .catch(() => {
        if (active) {
          current.error =
            "This phone could not open its scoring storage. Check browser storage and reload.";
          current.publish();
        }
      });
    return () => {
      active = false;
      unwatch();
      sender.current?.stop();
      sender.current = null;
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [fixtureId]);
  function apply<T extends EventType>(
    type: T,
    payload: PayloadOf<T>,
    target: string | null = null,
  ) {
    const id = model.current?.apply(type, payload, target) ?? null;
    if (id) void sender.current?.flush();
    return id;
  }
  return {
    ...view,
    async takeOver() {
      const current = model.current;
      if (!current || !navigator.onLine)
        throw new Error("Connect to the internet to take over scoring.");
      if (current.items.length)
        throw new Error(
          "Send or review saved balls before taking over. Your saved balls remain on this phone.",
        );
      const wasReady = current.ready;
      current.ready = false;
      current.publish();
      sender.current?.stop();
      sender.current = null;
      let claimed = false;
      try {
        await current.whenDurable();
        const response = await fetch(`/api/score/${fixtureId}/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "force",
            deviceId: current.deviceId || (await scoringDevice()),
          }),
        });
        const result = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || !result.ok)
          throw new Error(result.message ?? "This phone cannot take over scoring.");
        claimed = true;
        const canonical = await readHistory(fixtureId);
        current.resumeAfterTakeover(canonical.events);
        await current.whenDurable();
        sender.current = startSync(fixtureId, current);
      } catch (error) {
        // A claimed device stays disabled until authoritative history loads successfully.
        if (!claimed) {
          current.ready = wasReady;
          sender.current = startSync(fixtureId, current);
        }
        current.publish();
        throw error;
      }
    },
    apply,
    accepted(id: string) {
      return model.current?.history.some((event) => event.eventId === id) ?? false;
    },
    whenDurable() {
      return model.current?.whenDurable() ?? Promise.resolve();
    },
    preview(entries: readonly FamilyLocalEntry[]) {
      return model.current?.preview(entries) ?? view.state;
    },
    applyBatch(entries: readonly FamilyLocalEntry[]) {
      const ids = model.current?.applyBatch(entries) ?? null;
      if (ids) void sender.current?.flush();
      return ids;
    },
    undo(eventId?: string) {
      const done = model.current?.undo(eventId) ?? false;
      if (done) void sender.current?.flush();
      return done;
    },
    dismissError() {
      model.current?.dismissError();
    },
  };
}
