import type { LobbyPoints } from "../../standings";
export interface PlacementFormat {
  key: string;
  label: string;
  rounds: number;
  points: LobbyPoints;
}
