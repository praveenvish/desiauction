import type { PublicLiveState } from "./types";
/** Trust is independent of the scoring sequence; a downgrade must invalidate 304. */
export function liveRepresentationEtag(
  state: Pick<PublicLiveState, "seq" | "trust">,
  view: "live" | "scorecard" | "charts" | "result" = "live",
  resultRevision?: string,
) {
  const prefix = view === "live" ? "" : `${view}-`;
  const revision = view === "result" ? `-${resultRevision ?? "unavailable"}` : "";
  return `"${prefix}${String(state.seq)}${revision}-${state.trust}"`;
}
