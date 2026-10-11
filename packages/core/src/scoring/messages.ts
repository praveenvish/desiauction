import type { RejectReason } from "./types";

export const REJECT_MESSAGES: Record<RejectReason, string> = {
  not_live: "The match isn't being scored right now.",
  wrong_attempt: "This match was restarted. Reload to continue.",
  unknown_player: "That player isn't in either XI.",
  not_batting: "That batter isn't at the crease.",
  bowler_not_fielding: "The bowler must be from the fielding side.",
  bowler_consecutive: "{name} bowled the last over. Pick someone else.",
  bowler_quota: "{name} has bowled all {n} overs.",
  illegal_wicket_on_extra: "That dismissal isn't possible on a {extra}.",
  free_hit_dismissal: "Only a run out is possible on a free hit.",
  runs_out_of_range: "Runs must be between 0 and 10.",
  boundary_mismatch: "A boundary must be 4 or 6 runs off the bat.",
  innings_over: "This innings is complete.",
  no_open_innings: "Start the innings first.",
  target_reached: "The target is reached. Finish the match.",
  already_finished: "This match is finished. Corrections go through the organiser.",
  unknown_target: "That ball no longer exists.",
  amend_type_mismatch: "A correction must keep the same kind of entry.",
  amend_breaks_later_events: "That change makes a later ball impossible. Fix the later ball first.",
  bad_payload: "That entry is incomplete.",
  duplicate: "",
};
