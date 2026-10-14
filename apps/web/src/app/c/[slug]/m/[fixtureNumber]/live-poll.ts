import { projectRaidClockContext } from "@desiauction/core/scoring/raid-clock";
import { liveRepresentationEtag } from "@desiauction/core/scoring/live-etag";
import type {
  RaidClockContext,
  PublicScoringState as PublicLiveState,
  PublicScorecard,
  PublicCharts,
} from "@desiauction/core/scoring";
import type { PublicResultDetails } from "../../../../../server/scoring/result-details";
export interface LiveObservation {
  clock?: RaidClockContext;
  clockObservedAt?: number;
  state: PublicLiveState | null;
  scorecard?: PublicScorecard;
  charts?: PublicCharts;
  resultDetails?: PublicResultDetails | null;
  failures: number;
  changedAt: number;
}
export function pollDelay(
  state: PublicLiveState | null,
  visible: boolean,
  failures: number,
): number | null {
  if (
    state &&
    ["finished", "final", "walkover", "no_result", "abandoned", "void"].includes(state.phase)
  )
    return null;
  const base =
    visible && (state?.phase === "live" || state?.phase === "result_reached") ? 2000 : 15000;
  return failures ? Math.min(30000, base * 2 ** failures) : base;
}
export function stale(observation: LiveObservation, now: number): boolean {
  return observation.state?.phase === "live" && now - observation.changedAt >= 60000;
}
/** One request at a time; visibility changes reschedule and teardown aborts late replies. */
export class LivePoll {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | undefined;
  private stopped = false;
  private visible = true;
  readonly observation: LiveObservation;
  constructor(
    private url: string,
    initial: PublicLiveState | null,
    private publish: (value: LiveObservation) => void,
    private fetcher: typeof fetch = fetch,
    private now: () => number = Date.now,
    private scorecardView = false,
    previous?: LiveObservation,
    private chartsView = false,
    private resultView = false,
  ) {
    this.observation = previous
      ? { ...previous }
      : { state: initial, failures: 0, changedAt: now() };
  }
  start(visible: boolean, immediate = false) {
    this.visible = visible;
    if (immediate) void this.poll();
    else this.schedule();
  }
  visibility(visible: boolean) {
    this.visible = visible;
    this.schedule();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.request?.abort();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped || this.request) return;
    const delay = pollDelay(this.observation.state, this.visible, this.observation.failures);
    if (delay !== null)
      this.timer = setTimeout(() => {
        void this.poll();
      }, delay);
  }
  private async poll() {
    const request = new AbortController();
    this.request = request;
    try {
      // Browser fetch rejects a LivePoll receiver; call it as a standalone function.
      const fetcher = this.fetcher;
      const detail = this.chartsView ? this.observation.charts : this.observation.scorecard;
      const response = await fetcher(this.url, {
        signal: request.signal,
        headers:
          this.observation.state &&
          (!(this.scorecardView || this.chartsView) || detail?.seq === this.observation.state.seq)
            ? {
                "If-None-Match": liveRepresentationEtag(
                  this.observation.state,
                  this.resultView
                    ? "result"
                    : this.chartsView
                      ? "charts"
                      : this.scorecardView
                        ? "scorecard"
                        : "live",
                  this.observation.resultDetails?.revision,
                ),
              }
            : {},
        cache: "no-store",
      });
      if (this.stopped) return;
      const serverTime = response.headers.get("X-LS1-Server-Time"),
        delay = response.headers.get("X-LS1-Clock-Delay");
      const clock =
        serverTime !== null && delay !== null
          ? projectRaidClockContext({ serverAtMs: Number(serverTime), delayMs: Number(delay) })
          : null;
      if ((response.ok || response.status === 304) && clock) {
        this.observation.clock = clock;
        this.observation.clockObservedAt = performance.now();
      }

      if (response.status === 304) this.observation.failures = 0;
      else if (response.ok) {
        const body = (await response.json()) as
          | PublicLiveState
          | {
              live: PublicLiveState;
              scorecard?: PublicScorecard;
              charts?: PublicCharts;
              resultDetails?: PublicResultDetails | null;
            };
        const state = "live" in body ? body.live : body;
        const scorecard = "live" in body ? body.scorecard : undefined;
        const charts = "live" in body ? body.charts : undefined;
        const resultDetails = "live" in body ? body.resultDetails : undefined;
        if (this.scorecardView && (!scorecard || scorecard.seq !== state.seq))
          throw new Error("Scorecard sequence is inconsistent");
        if (this.chartsView && (!charts || charts.seq !== state.seq))
          throw new Error("Chart sequence is inconsistent");
        if (this.isStopped()) return;
        if (state.seq !== this.observation.state?.seq) this.observation.changedAt = this.now();
        this.observation.state = state;
        if (this.resultView) this.observation.resultDetails = resultDetails ?? null;
        else if (this.observation.resultDetails?.seq !== state.seq)
          delete this.observation.resultDetails;
        if (scorecard) this.observation.scorecard = scorecard;
        else if (this.observation.scorecard?.seq !== state.seq) delete this.observation.scorecard;
        if (charts) this.observation.charts = charts;
        else if (this.observation.charts?.seq !== state.seq) delete this.observation.charts;
        this.observation.failures = 0;
      } else this.observation.failures += 1;
    } catch {
      if (!this.stopped) this.observation.failures += 1;
    } finally {
      this.request = undefined;
      if (!this.stopped) {
        this.publish({ ...this.observation });
        this.schedule();
      }
    }
  }
  private isStopped() {
    return this.stopped;
  }
}
