import { Pill, TeamChip, type KitTone } from "@desiauction/ui";
import Link from "next/link";

import type { CareerSeason } from "../../server/player/career";

/**
 * One season of a player's career, as a card: the sport and year, where it
 * stands (one pill), the competition and club, and the team in its own colour.
 * Shared by /me and /me/[sport] so the two tell a season the same way.
 */

const ENTRY: Record<string, { label: string; tone: KitTone }> = {
  submitted: { label: "Waiting for approval", tone: "blue" },
  approved: { label: "In the pool", tone: "green" },
  waitlisted: { label: "Waitlisted", tone: "amber" },
  rejected: { label: "Not accepted", tone: "red" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  draft: { label: "Not submitted", tone: "neutral" },
};

/** Where a season stands for this person: the auction's word once there is
 *  one, the registration's until then. */
export function verdictOf(
  season: CareerSeason,
  money: (paise: number) => string,
): { label: string; tone: KitTone } {
  const outcome = season.auction;
  if (outcome === null) {
    return season.teamName !== null
      ? { label: "In the squad", tone: "green" }
      : (ENTRY[season.status] ?? { label: season.status, tone: "neutral" });
  }
  if (outcome.kind === "sold") {
    return { label: `Sold · ${money(outcome.soldPrice)}`, tone: "gold" };
  }
  if (outcome.kind === "unsold") return { label: "Unsold", tone: "neutral" };
  if (outcome.kind === "icon") return { label: "Icon player", tone: "purple" };
  if (outcome.kind === "captain")
    return { label: "Captain · picked before the auction", tone: "purple" };
  return { label: "Retained", tone: "purple" };
}

export function RegistrationCard({
  season,
  eyebrow,
  subline,
  money,
}: {
  season: CareerSeason;
  /** The small line above the name — "Cricket · 2026". */
  eyebrow: string;
  /** Under the name — the club, and whatever else the page adds. */
  subline: string;
  money: (paise: number) => string;
}) {
  const verdict = verdictOf(season, money);
  return (
    <Link href={`/seasons/${season.competitionSlug}/register`} className="me-reg">
      <span className="me-reg-top">
        <span className="me-reg-when">{eyebrow}</span>
        <Pill tone={verdict.tone} dot>
          {verdict.label}
        </Pill>
      </span>
      <strong className="me-reg-name">
        {season.tournamentName !== null && season.tournamentName !== season.competitionName
          ? `${season.tournamentName} · ${season.competitionName}`
          : season.competitionName}
      </strong>
      <span className="me-reg-org">{subline}</span>
      <span className="me-reg-foot">
        {season.teamName !== null ? (
          <TeamChip color={season.teamColor}>{season.teamName}</TeamChip>
        ) : (
          <span className="me-reg-noteam">No team yet</span>
        )}
        {season.isCaptain && season.auction?.kind !== "captain" ? (
          <Pill tone="purple">Captain</Pill>
        ) : season.isViceCaptain ? (
          <Pill tone="purple">Vice-captain</Pill>
        ) : null}
      </span>
    </Link>
  );
}
