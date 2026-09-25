import {
  ButtonLink,
  IconArrowRight,
  IconFileCheck,
  IconGavel,
  IconRupee,
  IconShieldCheck,
  IconUsers,
  IconWallet,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";
import Link from "next/link";

import { moneyFormat } from "../../lib/money";
import { planView } from "../../server/auction/owner-plan-actions";
import { seasonUnit } from "../../server/competition/season-unit";
import type { OwnedTeam } from "../../server/roles/roles";
import type { Tone } from "./home-parts";

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

/** Share of a whole, as the 0–100 a stat card's bar takes; 0 for no whole. */
function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

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
  return (
    <SectionCard
      data-testid="home-owner"
      icon={<IconShieldCheck />}
      tone="gold"
      title={team.teamName}
      description={team.competitionName}
      action={
        <Pill tone={status.tone} dot={status.dot === true}>
          {status.label}
        </Pill>
      }
    >
      {plan !== null ? (
        <StatGrid testId="home-owner-figures">
          <StatCard
            icon={<IconWallet />}
            tone="gold"
            value={money.compactFloor(plan.standing.purseRemaining)}
            label="Purse left"
            // The whole purse in full: "of 1 L pts" put the lakh shorthand on a
            // points purse, which nobody counts that way — "of 1,00,000 pts".
            hint={`of ${money.ledger(plan.rules.pursePerTeam)}`}
            progress={pct(plan.standing.purseRemaining, plan.rules.pursePerTeam)}
          />
          <StatCard
            icon={<IconUsers />}
            tone="blue"
            value={`${String(plan.standing.squadSize)} / ${String(plan.rules.squadMax)}`}
            label="Squad"
            hint={squadHint(plan.standing.squadSize, plan.rules.squadMin, plan.rules.squadMax)}
            progress={pct(plan.standing.squadSize, plan.rules.squadMax)}
          />
          {/* Before the night the plan is the work; after it, what was spent
              is the fact — a count of targets for a finished auction means
              nothing. */}
          {over ? (
            <StatCard
              // The rupee glyph only on rupees: "Spent 89,500 pts" under a ₹
              // told a points league it had spent money (0091).
              icon={unit === "inr" ? <IconRupee /> : <IconGavel />}
              tone="green"
              value={money.compact(plan.rules.pursePerTeam - plan.standing.purseRemaining)}
              label="Spent"
              hint="at the auction"
            />
          ) : (
            <StatCard
              icon={<IconFileCheck />}
              tone="purple"
              value={`${String(plan.targets.length)} target${plan.targets.length === 1 ? "" : "s"}`}
              label="My plan"
              hint="only you can see it"
              href={`${base}/auction/plan`}
              linkComponent={Link}
            />
          )}
        </StatGrid>
      ) : null}
      <nav className="home-owner-links" aria-label={`${team.teamName} shortcuts`}>
        {/*
         * THE SQUAD, not the grid. "Team page" opened every team in the season
         * and left the owner to find their own; `?team=` opens theirs, with the
         * buy prices. After the auction it is the thing to look at — Fixtures
         * may well be empty for weeks — so it leads.
         */}
        {over ? (
          <>
            <ButtonLink href={squadHref} size="sm" data-testid="home-owner-squad">
              My squad
              <IconArrowRight size={14} />
            </ButtonLink>
            <ButtonLink href={`${base}/fixtures`} size="sm" variant="secondary">
              Fixtures
            </ButtonLink>
          </>
        ) : (
          <ButtonLink
            href={`${base}/auction/live`}
            size="sm"
            variant={live ? "primary" : "secondary"}
          >
            {live ? "Enter the live room" : "Auction room"}
            <IconArrowRight size={14} />
          </ButtonLink>
        )}
        {over ? null : (
          <ButtonLink href={`${base}/auction/plan`} size="sm" variant="secondary">
            My plan
          </ButtonLink>
        )}
        {over ? null : (
          <ButtonLink href={squadHref} size="sm" variant="ghost" data-testid="home-owner-squad">
            My squad
          </ButtonLink>
        )}
      </nav>
    </SectionCard>
  );
}
