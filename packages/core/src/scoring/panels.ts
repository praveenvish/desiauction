import { projectPlacementPanel } from "./placement/panel";
import type { PlacementPanel } from "./placement/panel-types";
import { projectTimedPanel } from "./timed/panel";
import type { TimedPanel } from "./timed/public-state";
import { projectRaidPanel } from "./raid/panel";
import type { RaidPanel } from "./raid/public-state";
import { projectRallyPanel } from "./rally/panel";
import type { RallyPanel } from "./rally/public-state";
import type { ScoringFamily } from "./types";
import type { DeliveryPanel } from "./delivery/public-state";
/** Closed family envelope. Future family projectors are added with their engines. */
export function publicFamilyPanel(
  raw: unknown,
  trustedFamily?: ScoringFamily,
):
  | { family: "delivery"; panel: DeliveryPanel }
  | { family: "rally"; panel: RallyPanel }
  | { family: "raid"; panel: RaidPanel }
  | { family: "timed"; panel: TimedPanel }
  | { family: "placement"; panel: PlacementPanel }
  | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!("family" in value) && !("panel" in value)) {
    return trustedFamily === "delivery" ? { family: "delivery", panel: { v: 1 } } : null;
  }
  if (value["family"] === "placement") {
    if (trustedFamily !== undefined && trustedFamily !== "placement") return null;
    const panel = projectPlacementPanel(value["panel"]);
    return panel ? { family: "placement", panel } : null;
  }
  if (value["family"] === "timed") {
    if (trustedFamily !== undefined && trustedFamily !== "timed") return null;
    const panel = projectTimedPanel(value["panel"]);
    return panel ? { family: "timed", panel } : null;
  }
  if (value["family"] === "raid") {
    if (trustedFamily !== undefined && trustedFamily !== "raid") return null;
    const panel = projectRaidPanel(value["panel"]);
    return panel ? { family: "raid", panel } : null;
  }
  if (value["family"] === "rally") {
    if (trustedFamily !== undefined && trustedFamily !== "rally") return null;
    const panel = projectRallyPanel(value["panel"]);
    return panel ? { family: "rally", panel } : null;
  }
  if (
    value["family"] !== "delivery" ||
    (trustedFamily !== undefined && trustedFamily !== "delivery")
  )
    return null;
  const panel = value["panel"];
  if (
    !panel ||
    typeof panel !== "object" ||
    Array.isArray(panel) ||
    !("v" in panel) ||
    panel.v !== 1
  )
    return null;
  return { family: "delivery", panel: { v: 1 } };
}
