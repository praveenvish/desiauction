import type { BattingHand, ZoneKey } from "./types";

const CENTRES: Record<ZoneKey, number> = {
  long_off: 22,
  cover: 67,
  point: 112,
  third_man: 157,
  fine_leg: 202,
  square_leg: 247,
  mid_wicket: 292,
  long_on: 337,
};
export const ZONE_LABELS: Record<"en" | "hi", Record<ZoneKey, string>> = {
  en: {
    long_off: "long off",
    cover: "cover",
    point: "point",
    third_man: "third man",
    fine_leg: "fine leg",
    square_leg: "square leg",
    mid_wicket: "mid wicket",
    long_on: "long on",
  },
  hi: {
    long_off: "लॉन्ग ऑफ",
    cover: "कवर",
    point: "पॉइंट",
    third_man: "थर्ड मैन",
    fine_leg: "फाइन लेग",
    square_leg: "स्क्वायर लेग",
    mid_wicket: "मिड विकेट",
    long_on: "लॉन्ग ऑन",
  },
};
function normalise(angle: number): number {
  return ((angle % 360) + 360) % 360;
}
export function mirrorForHand(angle: number, hand: BattingHand): number {
  return normalise(hand === "left" ? 360 - angle : angle);
}
export function zoneAngle(zone: ZoneKey, hand: BattingHand): number {
  return mirrorForHand(CENTRES[zone], hand);
}
export function zoneOfAngle(angle: number, hand: BattingHand): ZoneKey {
  const canonical = mirrorForHand(angle, hand);
  let closest: ZoneKey = "long_off";
  let distance = Infinity;
  for (const key of Object.keys(CENTRES) as ZoneKey[]) {
    const delta = Math.abs(canonical - CENTRES[key]);
    const circular = Math.min(delta, 360 - delta);
    if (circular < distance) {
      closest = key;
      distance = circular;
    }
  }
  return closest;
}
