import {
  ButtonLink,
  IconChart,
  IconShieldCheck,
  IconUsers,
  IconWallet,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";

import { compactFloorINR, compactINR } from "../../lib/inr";
import { planView } from "../../server/auction/owner-plan-actions";
import type { OwnedTeam } from "../../server/roles/roles";

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
 */
const STATUS_LABEL: Record<string, string> = {
  scheduled: "Auction coming up",
  live: "Auction live",
  paused: "Auction paused",
  completed: "Auction finished",
  reconciled: "Auction finished",
};

export async function OwnerSection({ team }: { team: OwnedTeam }) {
  const plan = await planView(team.competitionSlug, team.teamId);
  const base = `/seasons/${team.competitionSlug}`;
  const live = team.auctionStatus === "live" || team.auctionStatus === "paused";
  const over = team.auctionStatus === "completed" || team.auctionStatus === "reconciled";
  const figures =
    plan === null
      ? null
      : [
          {
            label: "Purse left",
            value: compactFloorINR(plan.standing.purseRemaining),
            sub: `of ${compactINR(plan.rules.pursePerTeam)}`,
          },
          {
            label: "Squad",
            value: `${String(plan.standing.squadSize)} / ${String(plan.rules.squadMax)}`,
            sub: `at least ${String(plan.rules.squadMin)}`,
          },
          // Before the night the plan is the work; after it, what was spent is
          // the fact — a count of targets for a finished auction means nothing.
          over
            ? {
                label: "Spent",
                value: compactINR(plan.rules.pursePerTeam - plan.standing.purseRemaining),
                sub: "at the auction",
              }
            : {
                label: "My plan",
                value: `${String(plan.targets.length)} target${plan.targets.length === 1 ? "" : "s"}`,
                sub: "only you can see it",
              },
        ];
  const looks = [
    { icon: <IconWallet />, tone: "gold" },
    { icon: <IconUsers />, tone: "green" },
    { icon: <IconChart />, tone: "purple" },
  ] as const;
  return (
    <SectionCard
      className="home-owner"
      data-testid="home-owner"
      icon={<IconShieldCheck />}
      tone="gold"
      title={team.teamName}
      description={`${team.competitionName} · ${STATUS_LABEL[team.auctionStatus] ?? "Auction"}`}
      action={
        live ? (
          <Pill tone="red" dot>
            Live
          </Pill>
        ) : undefined
      }
    >
      {figures !== null ? (
        <StatGrid>
          {figures.map((figure, index) => (
            <StatCard
              key={figure.label}
              icon={looks[index % looks.length]?.icon ?? <IconChart />}
              tone={looks[index % looks.length]?.tone ?? "gold"}
              value={figure.value}
              label={figure.label}
              hint={figure.sub}
            />
          ))}
        </StatGrid>
      ) : null}
      <nav className="home-owner-links" aria-label={`${team.teamName} shortcuts`}>
        <ButtonLink href={`${base}/teams`} variant="secondary" size="touch">
          Team page
        </ButtonLink>
        {over ? (
          <ButtonLink href={`${base}/fixtures`} variant="secondary" size="touch">
            Fixtures
          </ButtonLink>
        ) : (
          <>
            <ButtonLink href={`${base}/auction/plan`} variant="secondary" size="touch">
              My plan
            </ButtonLink>
            <ButtonLink href={`${base}/auction/live`} variant="secondary" size="touch">
              {live ? "Enter the live room" : "Auction room"}
            </ButtonLink>
          </>
        )}
      </nav>
    </SectionCard>
  );
}
