import type { SeasonMatchLine, SeasonPlay } from "../../server/competition/season-play";

/**
 * THE REPORT, put into stages — pure, so where a season stands (the journey
 * strip at the top of /reports) and how a result is said are unit tests.
 */

export type StageTone = "done" | "now" | "next";

export interface Stage {
  readonly key: "registration" | "auction" | "season";
  readonly title: string;
  /** "Closed", "Done", "Playing"… */
  readonly state: string;
  readonly tone: StageTone;
  /** 0–100 for the strip's bar. */
  readonly pct: number;
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((Math.min(part, whole) / whole) * 100) : 0;

export function registrationStage(status: string, total: number): Stage {
  const open = status === "registration_open";
  const closed = status === "registration_closed";
  return {
    key: "registration",
    title: "Registration",
    state: open ? "Open" : closed ? "Closed" : "Not open yet",
    tone: closed ? "done" : open ? "now" : "next",
    pct: closed ? 100 : open ? (total > 0 ? 50 : 10) : 0,
  };
}

export function auctionStage(
  status: string | null,
  sold: number,
  unsold: number,
  remaining: number,
): Stage {
  const all = sold + unsold + remaining;
  const done = status === "completed" || status === "reconciled";
  const running = status === "live" || status === "paused";
  return {
    key: "auction",
    title: "Auction",
    state: done
      ? "Done"
      : running
        ? status === "paused"
          ? "Paused"
          : "Live"
        : status === "scheduled"
          ? "Scheduled"
          : "Not set up",
    tone: done ? "done" : running || status === "scheduled" ? "now" : "next",
    pct: pct(sold, all),
  };
}

export function seasonStage(play: Pick<SeasonPlay, "played" | "live" | "toCome">): Stage {
  const total = play.played + play.live + play.toCome;
  const finished = total > 0 && play.live === 0 && play.toCome === 0;
  const playing = play.played + play.live > 0 && !finished;
  return {
    key: "season",
    title: "Season",
    state: finished
      ? "Finished"
      : playing
        ? "Playing"
        : total > 0
          ? "Fixtures out"
          : "No fixtures yet",
    tone: finished ? "done" : playing || total > 0 ? "now" : "next",
    pct: pct(play.played, total),
  };
}

/** A result as a sentence: "Mumbai Mavericks beat Pune Panthers". */
export function resultSentence(match: Pick<SeasonMatchLine, "homeName" | "awayName" | "outcome">): {
  lead: string | null;
  rest: string;
} {
  const home = match.homeName ?? "Home";
  const away = match.awayName ?? "Away";
  switch (match.outcome) {
    case "home_win":
      return { lead: home, rest: ` beat ${away}` };
    case "away_win":
      return { lead: away, rest: ` beat ${home}` };
    case "tie":
      return { lead: null, rest: `${home} and ${away} tied` };
    case "abandoned":
      return { lead: null, rest: `${home} vs ${away} — abandoned` };
    case null:
      return { lead: null, rest: `${home} vs ${away}` };
    default:
      return { lead: null, rest: `${home} vs ${away} — no result` };
  }
}
