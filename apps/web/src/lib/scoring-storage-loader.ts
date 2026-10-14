/** One lazy loading context for scoring storage operations. */
export function loadScoringStorage() {
  return import("../app/score/offline-storage");
}
