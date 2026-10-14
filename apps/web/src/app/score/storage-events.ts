let stopped = false;
let generation = 0;
export const scoringStopGeneration = () => generation;
const stoppers = new Set<() => void>();
let channel: BroadcastChannel | undefined;
export const isScoringStopped = () => stopped;
export function resetScoringStops() {
  stopped = false;
}
export function clearScoringLocalStorage() {
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (key?.startsWith("ls1:")) localStorage.removeItem(key);
  }
}
function stop() {
  generation++;
  stopped = true;
  for (const listener of stoppers) listener();
}
function listen() {
  if (!channel && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("da-scoring-signout");
    channel.onmessage = () => {
      stop();
      clearScoringLocalStorage();
    };
  }
}
export function onScoringStop(listener: () => void): () => void {
  listen();
  stoppers.add(listener);
  return () => {
    stoppers.delete(listener);
  };
}
export function notifyScoringStop() {
  listen();
  stop();
  channel?.postMessage("signout");
  clearScoringLocalStorage();
  return generation;
}
