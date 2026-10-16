export interface PlacementPanel {
  v: 1;
  round: number;
  rounds: number;
  rows: { teamId: string; placement: number; points: number; kills: number }[];
}
