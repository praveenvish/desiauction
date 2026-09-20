import Link from "next/link";

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
  return (
    <section className="home-owner" aria-labelledby="home-owner-title" data-testid="home-owner">
      <header className="home-flat-head">
        <h2 id="home-owner-title" className="home-flat-title">
          {team.teamName}
        </h2>
        <span className="home-flat-meta">
          {team.competitionName} · {STATUS_LABEL[team.auctionStatus] ?? "Auction"}
        </span>
      </header>
      {figures !== null ? (
        <dl className="home-figures">
          {figures.map((figure) => (
            <div key={figure.label} className="home-figure">
              <dt>{figure.label}</dt>
              <dd className="home-figure-value">{figure.value}</dd>
              <dd className="home-figure-sub">{figure.sub}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <nav className="home-owner-links" aria-label={`${team.teamName} shortcuts`}>
        <Link href={`${base}/teams`}>Team page</Link>
        {over ? (
          <Link href={`${base}/fixtures`}>Fixtures</Link>
        ) : (
          <>
            <Link href={`${base}/auction/plan`}>My plan</Link>
            <Link href={`${base}/auction/live`}>
              {live ? "Enter the live room" : "Auction room"}
            </Link>
          </>
        )}
      </nav>
    </section>
  );
}
