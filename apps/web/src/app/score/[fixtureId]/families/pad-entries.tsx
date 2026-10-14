"use client";
import dynamic from "next/dynamic";
const loading = () => <p role="status">Opening scoring pad…</p>;
export const DeliveryPadEntry = dynamic(() => import("../pad").then((entry) => entry.Pad), {
  loading,
});
export const RallyPadEntry = dynamic(() => import("./rally-pad").then((entry) => entry.RallyPad), {
  loading,
});

export const RaidPadEntry = dynamic(() => import("./raid-pad").then((entry) => entry.RaidPad), {
  loading,
});

export const TimedPadEntry = dynamic(() => import("./timed-pad").then((entry) => entry.TimedPad), {
  loading,
});

export const PlacementPadEntry = dynamic(
  () => import("./placement-pad").then((entry) => entry.PlacementPad),
  { loading },
);
