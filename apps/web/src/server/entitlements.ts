export type Feature = "captain_brief" | "overlay_sponsor";
export function can(entity: { tier: string }, feature: Feature): boolean {
  return feature !== "captain_brief" || entity.tier === "pro" || entity.tier === "association";
}
