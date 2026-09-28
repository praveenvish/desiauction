import { Pill, RosterMark, TeamChip, type KitTone } from "@desiauction/ui";
import type { MoneyUnit } from "@desiauction/core";
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

/** The four facts a verdict is made from — a career season has them, and so
 *  does /home's `MyRegistration`, which is why this is not `CareerSeason`. */
export type VerdictFacts = Pick<CareerSeason, "auction" | "auctionUnit" | "status" | "teamName">;

/** Where a season stands for this person: the auction's word once there is
 *  one, the registration's until then. */
export function verdictOf(
  season: VerdictFacts,
  money: (paise: number, unit: MoneyUnit) => string,
): { label: string; tone: KitTone } {
  const outcome = season.auction;
  if (outcome === null) {
    return season.teamName !== null
      ? { label: "In the squad", tone: "green" }
      : (ENTRY[season.status] ?? { label: season.status, tone: "neutral" });
  }
  if (outcome.kind === "sold") {
    return { label: `Sold · ${money(outcome.soldPrice, season.auctionUnit)}`, tone: "gold" };
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
  /** Formats a sold price in its season's unit — rupees or points (0091). */
  money: (paise: number, unit: MoneyUnit) => string;
}) {
  const verdict = verdictOf(season, money);
  return (
    <Link href={`/seasons/${season.competitionSlug}/register`} className="me-reg da-lift">
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
          <RosterMark kind="captain" />
        ) : season.isViceCaptain ? (
          <RosterMark kind="vice-captain" />
        ) : null}
      </span>
    </Link>
  );
}

/**
 * One season as a ROW of the career (My sports): year, the season and club,
 * the team in its own colour, the role, and where it ended — a sold price is
 * the row's loudest figure. The card above stays for /home, where a season is
 * one of a few things on the page; here the seasons ARE the page.
 */
export function SeasonRow({
  season,
  year,
  roleLabel,
  money,
}: {
  season: CareerSeason;
  year: string;
  roleLabel: string;
  money: (paise: number, unit: MoneyUnit) => string;
}) {
  const outcome = season.auction;
  const verdict = verdictOf(season, money);
  return (
    <Link href={`/seasons/${season.competitionSlug}/register`} className="me-season">
      <span className="me-season-year">{year}</span>
      <span className="me-season-name">
        <strong>
          {season.tournamentName !== null && season.tournamentName !== season.competitionName
            ? `${season.tournamentName} · ${season.competitionName}`
            : season.competitionName}
        </strong>
        <span>
          {season.orgName}
          <span className="me-season-phone-year"> · {year}</span>
        </span>
      </span>
      <span className="me-season-team">
        {season.teamName !== null ? (
          <TeamChip color={season.teamColor}>{season.teamName}</TeamChip>
        ) : (
          <span className="me-reg-noteam">No team yet</span>
        )}
        {season.isCaptain && outcome?.kind !== "captain" ? (
          <RosterMark kind="captain" />
        ) : season.isViceCaptain ? (
          <RosterMark kind="vice-captain" />
        ) : null}
      </span>
      <span className="me-season-role">{roleLabel === "" ? "—" : roleLabel}</span>
      <span className="me-season-end">
        {outcome?.kind === "sold" ? (
          <span className="me-season-price">{money(outcome.soldPrice, season.auctionUnit)}</span>
        ) : (
          <Pill tone={verdict.tone} dot>
            {verdict.label}
          </Pill>
        )}
      </span>
    </Link>
  );
}
