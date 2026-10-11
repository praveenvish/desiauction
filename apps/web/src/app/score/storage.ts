import { createStore, promisifyRequest } from "idb-keyval";
// Same store as C24's default idb-keyval store; no migration or queue relocation.
const store = createStore("keyval-store", "keyval");
const EPOCH = "da:scoring-epoch";
let lease: Promise<string> | undefined;
export { onScoringStop } from "./storage-events";
import { isScoringStopped, resetScoringStops, notifyScoringStop } from "./storage-events";
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
export async function scoringWrite(
  entries: readonly [string, unknown][],
  projection?: { key: string; update: (value: unknown) => unknown },
): Promise<void> {
  const expected = await epoch();
  if (isScoringStopped()) throw new Error("Scoring storage closed after sign-out.");
  return store(
    "readwrite",
    (objectStore) =>
      new Promise<void>((resolve, reject) => {
        const request = objectStore.get(EPOCH);
        request.onsuccess = () => {
          if (isScoringStopped() || request.result !== expected) {
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
            value = updater(read.result as T | undefined);
            objectStore.put(value, key);
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
export async function bindScoringActor(actorId: string): Promise<void> {
  if (isScoringStopped()) {
    resetScoringStops();
    lease = undefined;
  }
  const previous = await scoringRead<string>("ls1:actor");
  if (previous && previous !== actorId) {
    await clearScoringStorage();
    resetScoringStops();
    lease = undefined;
  }
  await scoringWrite([["ls1:actor", actorId]]);
}
