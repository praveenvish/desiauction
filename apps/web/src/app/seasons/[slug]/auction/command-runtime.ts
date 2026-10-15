import { practiceIntentOutcome, type PracticeIntentResult } from "../../../../lib/practice-intent";
import {
  commandOutcome,
  commandResources,
  commandsConflict,
  recoveryContext,
  recoveryMarkers,
  reviewedMarkers,
  reservationConflict,
  type CommandOutcome,
  type RecoveryMarker,
} from "./command-state";

export interface CommandStorage {
  read: () => Promise<unknown>;
  update: (change: (value: unknown) => RecoveryMarker[]) => Promise<RecoveryMarker[]>;
}
/**
 * Recovery kept in this tab only — the fallback when the device store cannot
 * be opened, throws, or hangs. Bidding must never depend on browser storage:
 * without it a tab still guards its own double-submits; it only loses the
 * cross-tab and after-reload view.
 */
export function memoryCommandStorage(seed: readonly RecoveryMarker[] = []): CommandStorage {
  let value: RecoveryMarker[] = [...seed];
  return {
    read: () => Promise.resolve(value),
    update: (change) => {
      value = change(value);
      return Promise.resolve(value);
    },
  };
}

/** A device-store call that has not answered in this long counts as failed. */
export const STORAGE_TIMEOUT_MS = 3000;
function withinStorageTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Recovery storage did not answer."));
      }, STORAGE_TIMEOUT_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

export interface CommandLease {
  commandId: string;
  resources: string[];
}

/** Guards are synchronous; persisted markers coordinate overlapping tabs before dispatch. */
export class AuctionCommands {
  markers: RecoveryMarker[] = [];
  ready = false;
  stopped = false;
  error: string | null = null;
  /** True once recovery is kept in this tab only (no device storage). */
  degraded = false;
  private generation = 0;
  /** The room version last observed; settles bids whose answer was lost. */
  private lastVersion: number | null = null;
  private lostBids = new Map<string, number | null>();
  private active = new Map<string, readonly string[]>();
  private activeCommandIds = new Map<string, string>();
  private chains = new Set<CommandLease>();
  constructor(
    readonly actorId: string,
    readonly auctionId: string,
    private storage: CommandStorage,
    private changed: () => void,
    readonly boundaryId = auctionId,
  ) {}
  /** Switch to tab-only recovery, keeping what this tab already knows. */
  useMemory() {
    if (this.degraded) return;
    this.storage = memoryCommandStorage(this.markers);
    this.degraded = true;
    this.changed();
  }
  private async storageCall<T>(call: (storage: CommandStorage) => Promise<T>): Promise<T> {
    if (this.degraded) return call(this.storage);
    try {
      return await withinStorageTimeout(call(this.storage));
    } catch {
      this.useMemory();
      return call(this.storage);
    }
  }
  private async update(change: (previous: RecoveryMarker[]) => RecoveryMarker[]) {
    let corruption: unknown;
    const result = await this.storageCall((storage) =>
      storage.update((value) => {
        try {
          return change(recoveryMarkers(value, this.actorId, this.boundaryId));
        } catch (error) {
          corruption = error;
          return value as RecoveryMarker[];
        }
      }),
    );
    if (corruption)
      throw corruption instanceof Error ? corruption : new Error("Recovery update failed.");
    return recoveryMarkers(result, this.actorId, this.boundaryId);
  }
  private current(generation: number) {
    return generation === this.generation && !this.stopped;
  }
  private fail(error: unknown) {
    this.error = error instanceof Error ? error.message : "Auction recovery storage failed.";
    this.changed();
  }
  begin() {
    this.generation++;
    this.stopped = false;
    this.ready = false;
    this.error = null;
  }
  stop() {
    this.stopped = true;
    this.ready = false;
    this.generation++;
    this.markers = [];
    this.active.clear();
    this.activeCommandIds.clear();
    this.chains.clear();
    this.changed();
  }
  /** Presentation only: exact local submission identity, never a conflict or authority decision. */
  isCommandPending(commandId: string) {
    return [...this.activeCommandIds.values()].includes(commandId);
  }
  /** Presentation only: exact locally owned correction reservation identity. */
  isChainActive(commandId: string) {
    return [...this.chains].some((lease) => lease.commandId === commandId);
  }
  pending(control: string) {
    return this.active.has(control) || (control === "undo-hold" && this.chains.size > 0);
  }
  blocked(type: string, payload: Record<string, unknown>, lease?: CommandLease) {
    const resources = commandResources(type, payload);
    return (
      !this.ready ||
      this.stopped ||
      !!this.error ||
      [...this.chains].some(
        (chain) => chain !== lease && commandsConflict(resources, chain.resources),
      ) ||
      [...this.active.values()].some((other) => commandsConflict(resources, other)) ||
      this.markers.some(
        (marker) =>
          marker.state !== "reviewed" &&
          marker.commandId !== lease?.commandId &&
          reservationConflict(
            { type, context: payload, auctionId: this.auctionId, resources },
            marker,
          ),
      )
    );
  }
  acquireChain(type: string, payload: Record<string, unknown>): CommandLease | null {
    if (this.blocked(type, payload)) return null;
    const lease = { commandId: crypto.randomUUID(), resources: commandResources(type, payload) };
    this.chains.add(lease);
    this.changed();
    return lease;
  }
  async releaseChain(lease: CommandLease) {
    const generation = this.generation;
    try {
      if (this.current(generation)) {
        const markers = await this.update((previous) =>
          previous.filter((marker) => marker.commandId !== lease.commandId),
        );
        if (this.current(generation)) this.markers = markers;
      }
    } catch (error) {
      if (this.current(generation)) this.fail(error);
    } finally {
      this.chains.delete(lease);
      this.changed();
    }
  }
  async waitForRoom(control: string) {
    const generation = this.generation;
    // Bounded local observation only; no request or command is retried.
    const until = Date.now() + 5000;
    while (this.current(generation) && !this.error && Date.now() < until) {
      const marker = this.markers.find(
        (item) =>
          item.auctionId === this.auctionId &&
          item.control === control &&
          item.state !== "reviewed",
      );
      if (!marker) return true;
      if (marker.state !== "accepted") return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }
  async load(refresh = false) {
    if (this.stopped) return;
    const generation = this.generation;
    if (!refresh) this.ready = false;
    this.changed();
    try {
      const value = await this.storageCall((storage) => storage.read());
      if (!this.current(generation)) return;
      this.markers = recoveryMarkers(value, this.actorId, this.boundaryId);
      this.error = null;
      this.ready = true;
      this.changed();
    } catch (error) {
      if (this.current(generation)) this.fail(error);
    }
  }
  async dispatch(
    control: string,
    type: string,
    payload: Record<string, unknown>,
    submit: (commandId: string, immutable: Record<string, unknown>) => Promise<unknown>,
    batch?: RecoveryMarker["batch"],
    lease?: CommandLease,
  ): Promise<CommandOutcome> {
    return this.execute(
      control,
      type,
      payload,
      submit,
      batch,
      lease,
      false,
    ) as Promise<CommandOutcome>;
  }
  async dispatchPractice(
    control: string,
    type: string,
    payload: Record<string, unknown>,
    submit: (intentId: string, immutable: Record<string, unknown>) => Promise<unknown>,
  ): Promise<PracticeIntentResult | Extract<CommandOutcome, { kind: "not-started" | "unknown" }>> {
    return this.execute(control, type, payload, submit, undefined, undefined, true) as Promise<
      PracticeIntentResult | Extract<CommandOutcome, { kind: "not-started" | "unknown" }>
    >;
  }
  private async execute(
    control: string,
    type: string,
    payload: Record<string, unknown>,
    submit: (commandId: string, immutable: Record<string, unknown>) => Promise<unknown>,
    batch: RecoveryMarker["batch"] | undefined,
    lease: CommandLease | undefined,
    direct: boolean,
  ): Promise<CommandOutcome | PracticeIntentResult> {
    if (
      (lease && !this.chains.has(lease)) ||
      this.active.has(control) ||
      this.blocked(type, payload, lease)
    )
      return {
        kind: "not-started",
        message: "Review the pending command or recovery state first.",
      };
    const immutable = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const resources = commandResources(type, immutable);
    let commandId: string;
    try {
      commandId = crypto.randomUUID();
    } catch {
      return {
        kind: "not-started",
        message: "This browser cannot send auction commands securely.",
      };
    }
    this.active.set(control, resources);
    this.changed();
    const generation = this.generation;
    const marker: RecoveryMarker = {
      v: 1,
      commandId,
      actorId: this.actorId,
      auctionId: this.auctionId,
      boundaryId: this.boundaryId,
      control,
      type,
      resources,
      context: recoveryContext(immutable),
      state: "prepared",
      acknowledgedVersion: null,
      createdAt: new Date().toISOString(),
      ...(batch ? { batch: { targets: [...batch.targets], accepted: [...batch.accepted] } } : {}),
    };
    this.activeCommandIds.set(control, marker.commandId);
    let prepared = false;
    try {
      const reservation = { reserved: false };
      // Updaters never throw inside an IndexedDB request callback. Corruption is
      // checked beforehand and again as a refused reservation inside the transaction.
      const reservedMarkers = await this.update((previous) => {
        if (
          previous.some(
            (item) =>
              item.state !== "reviewed" &&
              item.commandId !== lease?.commandId &&
              reservationConflict(marker, item),
          ) ||
          previous.filter((item) => item.state !== "reviewed").length >= 128
        )
          return previous;
        reservation.reserved = true;
        return [
          ...previous.filter((item) => item.state === "reviewed").slice(-16),
          ...previous.filter((item) => item.state !== "reviewed"),
          ...(lease && !previous.some((item) => item.commandId === lease.commandId)
            ? [
                {
                  ...marker,
                  commandId: lease.commandId,
                  type: "UndoHoldChain",
                  resources: lease.resources,
                  control: "undo-hold",
                  context: {},
                },
              ]
            : []),
          marker,
        ];
      });
      if (!this.current(generation))
        return { kind: "not-started", message: "The command was not sent. Review recovery first." };
      this.markers = reservedMarkers;
      if (!reservation.reserved)
        return { kind: "not-started", message: "The command was not sent. Review recovery first." };
      prepared = true;
      let outcome: CommandOutcome | PracticeIntentResult;
      try {
        const answer = await submit(marker.commandId, immutable);
        outcome = direct
          ? practiceIntentOutcome(answer, marker.commandId)
          : commandOutcome(answer, marker.commandId);
      } catch {
        outcome = { kind: "unknown", message: "The connection ended before the auction answered." };
      }
      if (!this.current(generation))
        return {
          kind: "unknown",
          message: "The account or room changed before the answer arrived.",
        };
      try {
        const settledMarkers = await this.update((previous) => {
          return previous.flatMap((item) => {
            if (item.commandId !== marker.commandId) return [item];
            if (outcome.kind === "refused" || (direct && outcome.kind === "accepted")) return [];
            return [
              {
                ...item,
                ...(direct && "stage" in outcome
                  ? { lifecycle: { stage: outcome.stage, ended: outcome.ended } }
                  : {}),
                state: outcome.kind === "accepted" ? ("accepted" as const) : ("unknown" as const),
                acknowledgedVersion:
                  outcome.kind === "accepted" && "ack" in outcome ? outcome.ack.version : null,
              },
            ];
          });
        });
        if (this.current(generation)) this.markers = settledMarkers;
        if (type === "PlaceBid" && outcome.kind === "unknown")
          this.lostBids.set(marker.commandId, this.lastVersion);
      } catch (error) {
        if (this.current(generation)) this.fail(error);
      }
      return outcome;
    } catch (error) {
      if (this.current(generation)) this.fail(error);
      return prepared
        ? { kind: "unknown", message: "The command outcome could not be retained for recovery." }
        : { kind: "not-started", message: "Recovery storage failed. The command was not sent." };
    } finally {
      if (this.current(generation)) {
        this.active.delete(control);
        this.activeCommandIds.delete(control);
        this.changed();
      }
    }
  }
  async observe(version: number) {
    this.lastVersion = version;
    if (this.stopped || !this.ready || this.error) return;
    const settled = this.markers.filter(
      (marker) =>
        (marker.auctionId === this.auctionId &&
          marker.state === "accepted" &&
          marker.acknowledgedVersion !== null &&
          version >= marker.acknowledgedVersion) ||
        // A bid whose answer was lost in this tab is settled by the room
        // moving on: the price shown is current, and the engine refuses any
        // bid that does not raise it, so a fresh bid cannot double up.
        (marker.type === "PlaceBid" &&
          marker.state === "unknown" &&
          this.lostBids.has(marker.commandId) &&
          version > (this.lostBids.get(marker.commandId) ?? -1)),
    );
    if (!settled.length) return;
    const generation = this.generation;
    try {
      const markers = await this.update((value) =>
        value.filter((marker) => !settled.some((item) => item.commandId === marker.commandId)),
      );
      if (!this.current(generation)) return;
      for (const item of settled) this.lostBids.delete(item.commandId);
      this.markers = markers;
      this.changed();
    } catch (error) {
      if (this.current(generation)) this.fail(error);
    }
  }
  async review(commandId: string, authorisedRead: () => Promise<boolean>) {
    const generation = this.generation;
    try {
      if (!(await authorisedRead()))
        throw new Error("The current authorised room could not be read.");
      if (!this.current(generation)) return false;
      const markers = await this.update((value) => reviewedMarkers(value, commandId));
      if (!this.current(generation)) return false;
      this.markers = markers;
      this.changed();
      return true;
    } catch (error) {
      if (this.current(generation)) this.fail(error);
      return false;
    }
  }
}
