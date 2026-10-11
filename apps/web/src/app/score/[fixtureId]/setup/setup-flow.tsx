"use client";
import dynamic from "next/dynamic";
import type {
  ScoringSetup,
  RallyScoringSetup,
  RaidScoringSetup,
  TimedScoringSetup,
  PlacementScoringSetup,
  AcceptedScoringSetup,
} from "../../../../server/scoring/home";
const loading = () => (
  <main className="score-home score-setup" aria-busy="true" data-testid="setup-loading">
    <h1>Match setup</h1>
    <p role="status">Opening match setup…</p>
  </main>
);
const PlacementSetup = dynamic(
  () => import("./placement-setup").then((entry) => entry.PlacementSetup),
  { loading },
);
const TimedSetup = dynamic(() => import("./timed-setup").then((entry) => entry.TimedSetup), {
  loading,
});
const RaidSetup = dynamic(() => import("./raid-setup").then((entry) => entry.RaidSetup), {
  loading,
});
const RallySetup = dynamic(() => import("./rally-setup").then((entry) => entry.RallySetup), {
  loading,
});
const DeliverySetupFlow = dynamic(
  () => import("./delivery-setup").then((entry) => entry.DeliverySetupFlow),
  { loading },
);
export function SetupFlow(props: {
  setup:
    ScoringSetup | RallyScoringSetup | RaidScoringSetup | TimedScoringSetup | PlacementScoringSetup;
  actorId: string;
  accepted: AcceptedScoringSetup | null;
}) {
  if (props.setup.family === "placement")
    return <PlacementSetup setup={props.setup} actorId={props.actorId} />;
  if (props.setup.family === "timed")
    return <TimedSetup setup={props.setup} actorId={props.actorId} />;
  if (props.setup.family === "raid")
    return <RaidSetup setup={props.setup} actorId={props.actorId} />;
  return props.setup.family === "rally" ? (
    <RallySetup setup={props.setup} actorId={props.actorId} />
  ) : (
    <DeliverySetupFlow setup={props.setup} actorId={props.actorId} accepted={props.accepted} />
  );
}
