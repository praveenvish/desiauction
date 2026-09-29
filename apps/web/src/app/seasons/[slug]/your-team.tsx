import { ButtonLink, IconArrowRight } from "@desiauction/ui";

import { formatWallTime } from "../../../lib/format-date";
import { lineupWords } from "../../../lib/lineup-words";
import type { TeamSeason } from "../../../server/player/career";
import { TeamCrest } from "./_tabs/team-crest";
import { relativeDay, wallDay } from "./fixtures/schedule-model";

/**
 * YOUR TEAM, ON THE SEASON'S FRONT PAGE (2026-09-28) — one line for a team
 * owner: where the team stands and what it plays next, with the door to the
 * squad. Not a second home page: the owner home carries the squad and purse.
 * The owner's own team appeared here only as a "Your team" tag in a list.
 */
export function YourTeam({
  slug,
  team,
  season,
  today,
}: {
  slug: string;
  team: { id: string; name: string; shortName: string | null; color: string | null };
  season: TeamSeason | null;
  today: string;
}) {
  const place = season?.place ?? null;
  const record = season?.record;
  const next = season?.upcoming[0];
  const owed = season?.awaiting.length ?? 0;
  const standing = [
    place !== null ? `${ordinal(place.position)} of ${String(place.of)}` : null,
    place !== null ? `${String(place.points)} ${place.points === 1 ? "pt" : "pts"}` : null,
    record !== undefined && record.played > 0
      ? `won ${String(record.won)}, lost ${String(record.lost)}${record.tied > 0 ? `, tied ${String(record.tied)}` : ""}`
      : null,
  ].filter((part): part is string => part !== null);
  return (
    <section className="ov-yours" data-testid="your-team" aria-labelledby="ov-yours-title">
      <TeamCrest name={team.name} short={team.shortName} color={team.color} logoUrl={null} />
      <div className="ov-yours-text">
        <p className="ov-yours-kicker" id="ov-yours-title">
          Your team
        </p>
        <p className="ov-yours-line">
          <strong>{team.name}</strong>
          {standing.length > 0 ? ` · ${standing.join(" · ")}` : ""}
        </p>
        {next !== undefined ? (
          <p className="ov-yours-next">
            {next.live ? "Playing now" : "Next"}:{" "}
            <strong>
              {next.live ? "" : `${whenOf(next.kickoffAt, today)} `}vs {next.opponentName}
            </strong>
            {next.groundName !== null ? ` · ${next.groundName}` : ""}
            {next.live ? "" : ` · ${lineupWords(next.lineup)}`}
            {/* Said here as on owner home and /me (census 12). */}
            {owed > 0
              ? ` · ${String(owed)} ${owed === 1 ? "result" : "results"} still to come`
              : ""}
          </p>
        ) : owed > 0 ? (
          <p className="ov-yours-next">
            {String(owed)} {owed === 1 ? "match is" : "matches are"} awaiting a result
          </p>
        ) : null}
      </div>
      <ButtonLink
        href={`/seasons/${slug}/teams?team=${encodeURIComponent(team.id)}`}
        variant="primary"
        size="sm"
      >
        My team
        <IconArrowRight size={16} aria-hidden />
      </ButtonLink>
    </section>
  );
}

function whenOf(kickoffAt: string | null, today: string): string {
  if (kickoffAt === null) return "date to be set,";
  const day = kickoffAt.slice(0, 10);
  const words = relativeDay(day, today) ?? wallDay(day).label;
  return kickoffAt.length > 10 ? `${words} ${formatWallTime(kickoffAt)}` : words;
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${String(value)}th`;
  const suffix = ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${String(value)}${value % 10 > 3 ? "th" : suffix}`;
}
