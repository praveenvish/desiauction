import { ButtonLink, IconArrowRight, Pill, PlayerImage } from "@desiauction/ui";
import Link from "next/link";

import { moneyFormat } from "../../lib/money";
import { planView } from "../../server/auction/owner-plan-actions";
import { seasonUnit } from "../../server/competition/season-unit";
import type { OwnedTeam } from "../../server/roles/roles";
import type { Tone } from "./home-parts";
import "./owner-home.css";

/**
 * A TEAM OWNER'S HOME HALF (launch polish, Phase 2).
 *
 * An owner used to land on the organizer's dashboard for the whole club and
 * find nothing about the one team they run. This is that team: what is left in
 * the purse, how full the squad is, how far the plan has got — and the three
 * doors an owner actually uses.
 *
 * The figures come from `planView`, the same gated read the plan page uses, so
 * nothing here is visible that the plan page would not show this person. When
 * planning is switched off for the auction (or the gate declines), the section
 * keeps the doors and drops the figures rather than guessing them.
 *
 * Dressed in the organizer's kit — a section card, stat cards with the same
 * thin progress bars, pills for status — so an owner's home reads as the same
 * product as the club's, only narrower.
 */
const STATUS: Record<string, { label: string; tone: Tone; dot?: boolean }> = {
  scheduled: { label: "Auction coming up", tone: "blue" },
  live: { label: "Auction live", tone: "red", dot: true },
  paused: { label: "Auction paused", tone: "amber", dot: true },
  completed: { label: "Auction finished", tone: "green" },
  reconciled: { label: "Auction finished", tone: "green" },
};

/**
 * The line under "12 / 12". "at least 12" beside a full squad of 12 read as a
 * shortfall; when the minimum IS the maximum there is one number that matters,
 * and a full squad is simply complete.
 */
export function squadHint(size: number, min: number, max: number): string {
  if (size >= max) return "Squad complete";
  if (min === max) return `full squad ${String(max)}`;
  return `at least ${String(min)}`;
}

/** The purse as one graphic: the gold arc is what is LEFT. */
function PurseRing({ left, whole }: { left: number; whole: number }) {
  const share = whole <= 0 ? 0 : Math.max(0, Math.min(1, left / whole));
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ow-ring" viewBox="0 0 72 72" width="72" height="72" aria-hidden>
      <circle cx="36" cy="36" r={r} className="ow-ring-track" />
      {/* What is spent, drawn quietly; what is left, in gold, after it. */}
      <circle
        cx="36"
        cy="36"
        r={r}
        className="ow-ring-spent"
        strokeDasharray={`${String(c * (1 - share))} ${String(c)}`}
        transform={`rotate(${String(-90 + 360 * share)} 36 36)`}
      />
      <circle
        cx="36"
        cy="36"
        r={r}
        className="ow-ring-left"
        strokeDasharray={`${String(c * share)} ${String(c)}`}
        transform="rotate(-90 36 36)"
      />
    </svg>
  );
}

/** Two letters for the crest. */
function crestOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/*
 * WOW PASS (2026-09-25). One card holding three bordered stat cards with a
 * row of 28px buttons under them, then 590px of nothing — and "Purse left"
 * and "Spent" were the same fact twice. The team is now a hero object: crest,
 * name and state; the purse as one ring (left vs spent); the squad count; the
 * squad's faces as a strip; and the doors. No card inside a card.
 */
export async function OwnerSection({ team }: { team: OwnedTeam }) {
  const [plan, unit] = await Promise.all([
    planView(team.competitionSlug, team.teamId),
    seasonUnit(team.competitionSlug),
  ]);
  // The purse counts in the season's own unit — rupees or points (0091).
  const money = moneyFormat(unit);
  const base = `/seasons/${team.competitionSlug}`;
  const live = team.auctionStatus === "live" || team.auctionStatus === "paused";
  const over = team.auctionStatus === "completed" || team.auctionStatus === "reconciled";
  const status = STATUS[team.auctionStatus] ?? { label: "Auction", tone: "neutral" };
  const squadHref = `${base}/teams?team=${encodeURIComponent(team.teamId)}`;
  const bought =
    plan === null
      ? []
      : plan.lots
          .filter((lot) => lot.status === "sold" && lot.soldToTeamId === team.teamId)
          .sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0));
  const shown = bought.slice(0, 12);
  const titleId = `ow-${team.teamId}`;
  return (
    <section className="ow-hero" data-testid="home-owner" aria-labelledby={titleId}>
      <header className="ow-head">
        <span className="ow-crest" aria-hidden>
          {crestOf(team.teamName)}
        </span>
        <div className="ow-id">
          <p className="ow-kicker">My team · {team.competitionName}</p>
          <h2 id={titleId} className="ow-name">
            {team.teamName}
          </h2>
        </div>
        <Pill tone={status.tone} dot={status.dot === true}>
          {status.label}
        </Pill>
      </header>

      {plan !== null ? (
        <div className="ow-figures" data-testid="home-owner-figures">
          <div className="ow-purse">
            <PurseRing left={plan.standing.purseRemaining} whole={plan.rules.pursePerTeam} />
            <div className="ow-figure">
              <span className="ow-value">{money.compactFloor(plan.standing.purseRemaining)}</span>
              <span className="ow-label">
                Purse left
                {/* Spent is the other half of the same ring, said once. */}
                <span className="ow-hint">
                  {over
                    ? `${money.compact(plan.rules.pursePerTeam - plan.standing.purseRemaining)} spent of ${money.ledger(plan.rules.pursePerTeam)}`
                    : `of ${money.ledger(plan.rules.pursePerTeam)}`}
                </span>
              </span>
            </div>
          </div>
          <div className="ow-figure">
            <span className="ow-value">
              {String(plan.standing.squadSize)}
              <span className="ow-of">/{String(plan.rules.squadMax)}</span>
            </span>
            <span className="ow-label">
              Squad
              <span className="ow-hint">
                {squadHint(plan.standing.squadSize, plan.rules.squadMin, plan.rules.squadMax)}
              </span>
            </span>
          </div>
          {over ? null : (
            <Link className="ow-figure ow-figure-link" href={`${base}/auction/plan`}>
              <span className="ow-value">{String(plan.targets.length)}</span>
              <span className="ow-label">
                {plan.targets.length === 1 ? "Target" : "Targets"} in my plan
                <span className="ow-hint">only you can see it</span>
              </span>
            </Link>
          )}
        </div>
      ) : null}

      {shown.length > 0 ? (
        <Link className="ow-squad" href={squadHref} aria-label={`${team.teamName} squad`}>
          <ul className="ow-faces">
            {shown.map((lot) => (
              <li key={lot.lotId} title={lot.playerName ?? ""}>
                <PlayerImage
                  name={lot.playerName ?? "Player"}
                  seed={lot.registrationId}
                  src={plan?.lotMedia[lot.lotId]?.photoUrl ?? null}
                  size="sm"
                  shape="round"
                  decorative
                />
              </li>
            ))}
          </ul>
          <span className="ow-squad-more">
            {bought.length > shown.length ? `+${String(bought.length - shown.length)} more · ` : ""}
            See the squad
            <IconArrowRight size={16} />
          </span>
        </Link>
      ) : null}

      <nav className="ow-links" aria-label={`${team.teamName} shortcuts`}>
        {/*
         * THE SQUAD, not the grid. "Team page" opened every team in the season
         * and left the owner to find their own; `?team=` opens theirs, with the
         * buy prices. After the auction it is the thing to look at — Fixtures
         * may well be empty for weeks — so it leads.
         */}
        {over ? (
          <>
            <ButtonLink href={squadHref} data-testid="home-owner-squad">
              My squad
              <IconArrowRight size={16} />
            </ButtonLink>
            <ButtonLink href={`${base}/fixtures`} variant="secondary">
              Fixtures
            </ButtonLink>
          </>
        ) : (
          <ButtonLink href={`${base}/auction/live`} variant={live ? "primary" : "secondary"}>
            {live ? "Enter the live room" : "Auction room"}
            <IconArrowRight size={16} />
          </ButtonLink>
        )}
        {over ? null : (
          <ButtonLink href={`${base}/auction/plan`} variant="secondary">
            My plan
          </ButtonLink>
        )}
        {over ? null : (
          <ButtonLink href={squadHref} variant="ghost" data-testid="home-owner-squad">
            My squad
          </ButtonLink>
        )}
      </nav>
    </section>
  );
}
