import type {
  OverlayProjection,
  PublicScoringState as PublicLiveState,
} from "@desiauction/core/scoring";
export interface OverlayStat {
  subject: string;
  style: string;
  rate: number;
  sample: { balls: number; matches: number };
}
export interface PublicOverlay {
  live: PublicLiveState;
  overlay: OverlayProjection | null;
  stat: OverlayStat | null;
}
