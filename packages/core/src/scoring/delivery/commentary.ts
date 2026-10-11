import { ZONE_LABELS } from "../zones";
import type { NameBook } from "../types";
import type { BallSummary } from "./state";

export function commentaryLine(
  ball: BallSummary,
  names: NameBook,
  lang: "en" | "hi" = "en",
): string {
  const bowler = names.players[ball.bowlerId]?.name ?? ball.bowlerId;
  const batter = names.players[ball.strikerId]?.name ?? ball.strikerId;
  const extras = ball.extras;
  let result: string;
  if (ball.wicket) result = `OUT, ${ball.wicket.kind.replaceAll("_", " ")}`;
  else if (extras.wides) result = extras.wides === 1 ? "wide" : `${String(extras.wides)} wides`;
  else if (extras.noBall) {
    const added = ball.runsBat + (extras.byes ?? 0) + (extras.legByes ?? 0);
    result = `no ball${added ? ` and ${String(added)}` : ""}`;
  } else if (extras.byes) result = `${String(extras.byes)} ${extras.byes === 1 ? "bye" : "byes"}`;
  else if (extras.legByes)
    result = `${String(extras.legByes)} ${extras.legByes === 1 ? "leg bye" : "leg byes"}`;
  else if (ball.boundary) result = ball.boundary === 4 ? "FOUR" : "SIX";
  else
    result =
      ball.runsBat === 0 ? "no run" : ball.runsBat === 1 ? "1 run" : `${String(ball.runsBat)} runs`;
  if (lang === "hi") {
    if (ball.wicket) result = `आउट, ${HI_WICKETS[ball.wicket.kind]}`;
    else if (extras.wides) result = extras.wides === 1 ? "वाइड" : `${String(extras.wides)} वाइड`;
    else if (extras.noBall) {
      const added = ball.runsBat + (extras.byes ?? 0) + (extras.legByes ?? 0);
      result = `नो बॉल${added ? ` और ${String(added)}` : ""}`;
    } else if (extras.byes) result = `${String(extras.byes)} बाई`;
    else if (extras.legByes) result = `${String(extras.legByes)} लेग बाई`;
    else if (ball.boundary) result = ball.boundary === 4 ? "चौका" : "छक्का";
    else result = ball.runsBat === 0 ? "कोई रन नहीं" : `${String(ball.runsBat)} रन`;
  }
  if (ball.shot)
    result +=
      lang === "hi"
        ? ` ${ZONE_LABELS.hi[ball.shot.zone]} की ओर`
        : ` to ${ZONE_LABELS.en[ball.shot.zone]}`;
  if (lang === "hi") return `${ball.over} ${bowler} से ${batter} को, ${result}।`;
  return `${ball.over} ${bowler} to ${batter}, ${result}.`;
}

const HI_WICKETS = {
  bowled: "बोल्ड",
  caught: "कैच",
  lbw: "एलबीडब्ल्यू",
  stumped: "स्टंप",
  run_out: "रन आउट",
  hit_wicket: "हिट विकेट",
  obstructing: "फील्डिंग में बाधा",
  hit_twice: "दो बार गेंद मारी",
  timed_out: "टाइम आउट",
  caught_and_bowled: "कैच और बोल्ड",
} as const;
