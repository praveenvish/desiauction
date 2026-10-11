import type { NameBook, MatchEvent } from "@desiauction/core/scoring";
import type { FamilyScoringSetup } from "../../../server/scoring/home";
import { bindScoringActor, scoringRead, scoringWrite, onScoringStop } from "../storage";
import { registerServiceWorker, requestPersistentStorage } from "../../../lib/pwa";
export interface PreparedMatch {
  fixtureId: string;
  attempt: number | null;
  preparation: "started" | "unstarted";
  lastSeq: number;
  events: MatchEvent[];
  bootstrap: {
    actorId: string;
    names: NameBook;
    setup: FamilyScoringSetup | import("../../../server/scoring/home").ScoringSetup;
    language: "en" | "hi";
    sharePath: string;
    nextMatch: string | null;
  };
}
export const preparedKey = (id: string) => `ls1:prepared:${id}`;
export function preparedHistory(snapshot: number, events: readonly MatchEvent[]): boolean {
  return (
    Number.isSafeInteger(snapshot) &&
    snapshot >= 0 &&
    events.length === snapshot &&
    events.every((event, index) => event.seq === index + 1)
  );
}
export async function warmScoringShell(fetcher: typeof fetch = fetch): Promise<void> {
  const registration = await registerServiceWorker();
  await registration.update();
  const installing = registration.installing ?? registration.waiting;
  if (installing && installing.state !== "activated")
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        installing.removeEventListener("statechange", changed);
        reject(new Error("Offline scoring update is still installing. Retry preparation."));
      }, 15000);
      function changed() {
        if (installing?.state === "activated") {
          clearTimeout(timeout);
          installing.removeEventListener("statechange", changed);
          resolve();
        } else if (installing?.state === "redundant") {
          clearTimeout(timeout);
          installing.removeEventListener("statechange", changed);
          reject(new Error("Offline scoring update failed. Retry preparation."));
        }
      }
      installing.addEventListener("statechange", changed);
      changed();
    });
  await navigator.serviceWorker.ready;
  if (!registration.active)
    throw new Error("Offline scoring is not installed yet. Retry preparation.");
  const response = await fetcher("/score/shell", {
    cache: "reload",
    credentials: "omit",
    headers: { accept: "text/html" },
  });
  if (!response.ok) throw new Error("Offline scoring could not be prepared.");
  const html = await response.clone().text();
  const metadata = /<meta name="ls1-build-assets" content="([^"]+)"/.exec(html)?.[1];
  if (!metadata) throw new Error("Offline scoring build files are missing.");
  const assets = JSON.parse(decodeURIComponent(metadata)) as unknown;
  if (
    !Array.isArray(assets) ||
    assets.length === 0 ||
    assets.length > 200 ||
    assets.some(
      (asset) =>
        typeof asset !== "string" ||
        !/^\/_next\/static\/[A-Za-z0-9_./-]+$/.test(asset) ||
        asset.split("/").includes(".."),
    )
  )
    throw new Error("Offline scoring build files are invalid.");
  const staticCache = await caches.open("da-static");
  for (const asset of assets as string[]) {
    const file = await fetcher(asset, { cache: "reload", credentials: "omit" });
    if (
      !file.ok ||
      file.type !== "basic" ||
      !/\bimmutable\b/.test(file.headers.get("cache-control") ?? "")
    )
      throw new Error("An offline scoring file is unavailable. Retry preparation.");
    await staticCache.put(asset, file);
  }
  const cacheNames = await caches.keys();
  const shellCache = cacheNames.filter((name) => name.startsWith("da-shell-")).at(-1);
  if (!shellCache) throw new Error("Offline scoring storage is unavailable.");
  await (await caches.open(shellCache)).put("/score/shell", response);
}
export async function fetchPreparedSnapshot(
  fixtureId: string,
  fetcher: typeof fetch = fetch,
): Promise<PreparedMatch | null> {
  const first = await fetcher(`/api/score/${fixtureId}/events?since=0&prepare=1`, {
    cache: "no-store",
  });
  const snapshot = (await first.json()) as Omit<PreparedMatch, "bootstrap"> & {
    bootstrap?: PreparedMatch["bootstrap"];
    message?: string;
  };
  if (!first.ok || !snapshot.bootstrap)
    throw new Error(snapshot.message ?? "Start the match online before preparing offline scoring.");
  const events = [...snapshot.events];
  let changedAttempt = false;
  while ((events.at(-1)?.seq ?? 0) < snapshot.lastSeq) {
    const since = events.at(-1)?.seq ?? 0;
    const response = await fetcher(`/api/score/${fixtureId}/events?since=${String(since)}`, {
      cache: "no-store",
    });
    const page = (await response.json()) as {
      attempt: number;
      lastSeq: number;
      events: MatchEvent[];
      message?: string;
    };
    if (!response.ok) throw new Error(page.message ?? "Match history could not be prepared.");
    if (page.attempt !== snapshot.attempt) {
      changedAttempt = true;
      break;
    }
    const slice = page.events.filter((event) => event.seq <= snapshot.lastSeq);
    if (slice.length === 0 || slice[0]?.seq !== since + 1)
      throw new Error("Match history changed. Retry preparation.");
    events.push(...slice);
  }
  if (changedAttempt) return null;
  if (!preparedHistory(snapshot.lastSeq, events))
    throw new Error("Incomplete match history. Retry preparation.");
  return {
    fixtureId,
    attempt: snapshot.attempt,
    preparation: snapshot.preparation,
    lastSeq: snapshot.lastSeq,
    events,
    bootstrap: snapshot.bootstrap,
  };
}

/** Publish one complete canonical snapshot; unsent queue storage is independent. */
export async function prepareMatch(
  fixtureId: string,
  fetcher: typeof fetch = fetch,
): Promise<PreparedMatch> {
  let stopped = false;
  const isStopped = () => stopped;
  const unwatch = onScoringStop(() => {
    stopped = true;
  });
  try {
    for (let retry = 0; retry < 3; retry++) {
      const snapshot = await fetchPreparedSnapshot(fixtureId, fetcher);
      if (!snapshot) continue;
      if (isStopped()) throw new Error("Preparation stopped after sign-out.");
      await bindScoringActor(snapshot.bootstrap.actorId);
      if (isStopped()) throw new Error("Preparation stopped after sign-out.");
      await warmScoringShell(fetcher);
      const confirmation = await fetcher(
        snapshot.preparation === "unstarted"
          ? `/api/score/${fixtureId}/events?since=0&prepare=1`
          : `/api/score/${fixtureId}/events?since=${String(snapshot.lastSeq)}`,
        { cache: "no-store" },
      );
      const confirmed = (await confirmation.json()) as {
        attempt?: number | null;
        message?: string;
      };
      if (!confirmation.ok)
        throw new Error(confirmed.message ?? "Match permission changed during preparation.");
      if (confirmed.attempt !== snapshot.attempt) continue;
      if (isStopped()) throw new Error("Preparation stopped after sign-out.");
      const prepared: PreparedMatch = {
        fixtureId,
        attempt: snapshot.attempt,
        preparation: snapshot.preparation,
        lastSeq: snapshot.lastSeq,
        events: snapshot.events,
        bootstrap: snapshot.bootstrap,
      };
      await scoringWrite([[preparedKey(fixtureId), prepared]]);
      await requestPersistentStorage();
      return prepared;
    }
    throw new Error("This match restarted during preparation. Try again.");
  } finally {
    unwatch();
  }
}
export async function readPreparedMatch(fixtureId: string): Promise<PreparedMatch | null> {
  const [prepared, actorId] = await Promise.all([
    scoringRead<PreparedMatch>(preparedKey(fixtureId)),
    scoringRead<string>("ls1:actor"),
  ]);
  if (
    !prepared ||
    prepared.fixtureId !== fixtureId ||
    prepared.bootstrap.actorId !== actorId ||
    !preparedHistory(prepared.lastSeq, prepared.events)
  )
    return null;
  return prepared;
}

export type PreparationOutcome = {
  fixtureId: string;
  status: "ready" | "unstarted" | "failed";
  message?: string;
};
export async function prepareMatchDay(
  fixtureIds: readonly string[],
  prepare: (id: string) => Promise<PreparedMatch> = prepareMatch,
): Promise<PreparationOutcome[]> {
  const results: PreparationOutcome[] = [];
  for (const fixtureId of fixtureIds) {
    try {
      const match = await prepare(fixtureId);
      results.push({ fixtureId, status: match.preparation === "started" ? "ready" : "unstarted" });
    } catch (failure) {
      results.push({
        fixtureId,
        status: "failed",
        message:
          failure instanceof Error ? failure.message : "Preparation failed. Retry this match.",
      });
    }
  }
  return results;
}
