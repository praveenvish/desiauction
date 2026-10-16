import { createStore, promisifyRequest } from "idb-keyval";
import { createActorBinder, type ActorBindingReceipt } from "./actor-binding";
// Same store as C24's default idb-keyval store; no migration or queue relocation.
const store = createStore("keyval-store", "keyval");
const EPOCH = "da:scoring-epoch";
let lease: Promise<string> | undefined;
export { onScoringStop } from "./storage-events";
import {
  isScoringStopped,
  resetScoringStops,
  notifyScoringStop,
  scoringStopGeneration,
} from "./storage-events";
function epoch(): Promise<string> {
  if (!lease)
    lease = store(
      "readwrite",
      (objectStore) =>
        new Promise<string>((resolve, reject) => {
          const request = objectStore.get(EPOCH);
          request.onsuccess = () => {
            const value = typeof request.result === "string" ? request.result : crypto.randomUUID();
            if (!request.result) objectStore.put(value, EPOCH);
            objectStore.transaction.oncomplete = () => {
              resolve(value);
            };
            objectStore.transaction.onabort = () => {
              reject(
                objectStore.transaction.error ?? new Error("Scoring storage transaction failed."),
              );
            };
          };
          request.onerror = () => {
            reject(request.error ?? new Error("Scoring storage read failed."));
          };
        }),
    );
  return lease;
}
export async function scoringRead<T>(key: string): Promise<T | undefined> {
  if (isScoringStopped()) throw new Error("Scoring storage closed after sign-out.");
  await epoch();
  return store("readonly", (objectStore) => promisifyRequest<T | undefined>(objectStore.get(key)));
}
/** Epoch comparison and publication share one transaction: stale tabs cannot resurrect data. */
export function scoringWrite(
  entries: readonly [string, unknown][],
  projection?: { key: string; update: (value: unknown) => unknown },
): Promise<void> {
  return writeScoring(entries, projection);
}
async function writeScoring(
  entries: readonly [string, unknown][],
  projection?: { key: string; update: (value: unknown) => unknown },
  valid: () => boolean = () => true,
): Promise<void> {
  const expected = await epoch();
  if (isScoringStopped()) throw new Error("Scoring storage closed after sign-out.");
  return store(
    "readwrite",
    (objectStore) =>
      new Promise<void>((resolve, reject) => {
        const request = objectStore.get(EPOCH);
        request.onsuccess = () => {
          if (isScoringStopped() || request.result !== expected || !valid()) {
            objectStore.transaction.abort();
            return;
          }
          for (const [key, value] of entries) objectStore.put(value, key);
          if (projection) {
            const read = objectStore.get(projection.key);
            read.onsuccess = () => {
              if (read.result !== undefined)
                objectStore.put(projection.update(read.result), projection.key);
            };
          }
        };
        objectStore.transaction.oncomplete = () => {
          resolve();
        };
        objectStore.transaction.onabort = () => {
          reject(new Error("Scoring storage changed. Reload after signing in."));
        };
        objectStore.transaction.onerror = () => {
          reject(objectStore.transaction.error ?? new Error("Scoring storage transaction failed."));
        };
      }),
  );
}
export async function scoringUpdate<T>(
  key: string,
  updater: (previous: T | undefined) => T,
): Promise<T> {
  const expected = await epoch();
  if (isScoringStopped()) throw new Error("Scoring storage closed after sign-out.");
  return store(
    "readwrite",
    (objectStore) =>
      new Promise<T>((resolve, reject) => {
        let value: T;
        const check = objectStore.get(EPOCH);
        check.onsuccess = () => {
          if (isScoringStopped() || check.result !== expected) {
            objectStore.transaction.abort();
            return;
          }
          const read = objectStore.get(key);
          read.onsuccess = () => {
            try {
              value = updater(read.result as T | undefined);
              objectStore.put(value, key);
            } catch (error) {
              // A fail-closed updater must abort, not leave an unresolved IDB promise.
              objectStore.transaction.abort();
              reject(error instanceof Error ? error : new Error("Storage update refused."));
            }
          };
        };
        objectStore.transaction.oncomplete = () => {
          resolve(value);
        };
        objectStore.transaction.onabort = () => {
          reject(new Error("Scoring storage changed. Reload after signing in."));
        };
      }),
  );
}
export async function clearScoringStorage(): Promise<void> {
  notifyScoringStop();
  await purgeScoringStorage();
}
async function purgeScoringStorage(): Promise<void> {
  await store(
    "readwrite",
    (objectStore) =>
      new Promise<void>((resolve, reject) => {
        objectStore.put(crypto.randomUUID(), EPOCH);
        const request = objectStore.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (typeof cursor.key === "string" && cursor.key.startsWith("ls1:")) cursor.delete();
          cursor.continue();
        };
        objectStore.transaction.oncomplete = () => {
          resolve();
        };
        objectStore.transaction.onabort = () => {
          reject(objectStore.transaction.error ?? new Error("Scoring storage transaction failed."));
        };
      }),
  );
}
/** Only call with the actor supplied by an authenticated server page/response. */
export const bindScoringActor = createActorBinder({
  stopped: isScoringStopped,
  stopGeneration: scoringStopGeneration,
  reopen: () => {
    resetScoringStops();
    lease = undefined;
  },
  readActor: () => scoringRead<string>("ls1:actor"),
  stop: notifyScoringStop,
  purge: purgeScoringStorage,
  writeActor: (actorId, valid) => writeScoring([["ls1:actor", actorId]], undefined, valid),
});

/** Initialization validates the receipt once; later writes obey stop/epoch cancellation. */
export function scoringWorkGuard(receipt: ActorBindingReceipt) {
  if (!receipt.valid())
    throw new Error("Account storage binding changed. Reload after signing in.");
  const generation = scoringStopGeneration();
  return () => {
    if (isScoringStopped() || scoringStopGeneration() !== generation)
      throw new Error("Scoring stopped after account storage changed.");
  };
}
