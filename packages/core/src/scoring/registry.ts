import { placementEngine } from "./placement/engine";
import { timedEngine } from "./timed/engine";
import { raidEngine } from "./raid/engine";
import { deliveryEngine } from "./delivery/engine";
import { rallyEngine } from "./rally/engine";
export function engineFor(family: "placement"): typeof placementEngine;
export function engineFor(family: "delivery"): typeof deliveryEngine;
export function engineFor(family: "rally"): typeof rallyEngine;
export function engineFor(family: "timed"): typeof timedEngine;
export function engineFor(family: "raid"): typeof raidEngine;
export function engineFor(
  family: string,
):
  | typeof deliveryEngine
  | typeof rallyEngine
  | typeof raidEngine
  | typeof timedEngine
  | typeof placementEngine
  | null;
export function engineFor(
  family: string,
):
  | typeof deliveryEngine
  | typeof rallyEngine
  | typeof raidEngine
  | typeof timedEngine
  | typeof placementEngine
  | null {
  return family === "placement"
    ? placementEngine
    : family === "delivery"
      ? deliveryEngine
      : family === "rally"
        ? rallyEngine
        : family === "timed"
          ? timedEngine
          : family === "raid"
            ? raidEngine
            : null;
}
