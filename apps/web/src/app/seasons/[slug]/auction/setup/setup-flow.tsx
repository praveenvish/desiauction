"use client";

import { Badge, Button, ButtonLink, IconCheck, useToast } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  MIN_CLAIMED_TEAMS,
  setupSteps,
  type SetupStep,
  type StepId,
} from "../../../../../lib/auction-setup-steps";
import {
  auctionLifecycleAction,
  queueAllLotsAction,
  type AuctionDashboard,
} from "../../../../../server/auction/actions";
import { advanceCompetitionAction } from "../../../../../server/competition/actions";
import { BroadcastLinks } from "../broadcast-links";
import { ConnectionCheck } from "../live-experience";
import { OwnersStep } from "./owners-step";
import { RulesStep } from "./rules-step";
import "./setup.css";

/**
 * AUCTION SETUP — ONE PAGE, FIVE STEPS, EACH SAYING WHAT IS LEFT.
 *
 * See `lib/auction-setup-steps.ts` for why the steps are derived rather than
 * stored. The page renders the step that needs the organizer open, the ones
 * behind it collapsed to a one-line summary, and the ones ahead of it greyed
 * with what unlocks them — so the answer to "what do I do next?" is always the
 * open card.
 */
export function AuctionSetupFlow({
  slug,
  dashboard,
}: {
  slug: string;
  dashboard: AuctionDashboard;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<StepId>>(new Set());
  const [acceptShortOpen, setAcceptShortOpen] = useState(false);

  const { ready, view, viewer, overview, feasibility } = dashboard;
  const status = view?.auction.status ?? null;
  const exists = status !== null && status !== "abandoned";
  const claimedTeamIds = new Set((overview?.paddles ?? []).map((paddle) => paddle.teamId));
  const counts = overview === null ? null : overview.counts;
  const steps = setupSteps({
    checks: ready.checks,
    poolSize: ready.pool.filter((entry) => entry.teamId === null).length,
    teamCount: ready.teams.length,
    auctionStatus: status,
    claimedTeams: claimedTeamIds.size,
    counts: counts === null ? null : { queued: counts.queued, prepared: counts.prepared },
  });
  const stepOf = (id: StepId): SetupStep => {
    const found = steps.find((step) => step.id === id);
    if (found === undefined) {
      throw new Error(`unknown step ${id}`);
    }
    return found;
  };
  const doneCount = steps.filter((step) => step.state === "done").length;

  const run = async (
    key: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
  ) => {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    if (result.ok) {
      toast({ title: done, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Refused.", tone: "danger" });
    }
  };

  // The engine's go-live guard, said before the click (PA-1 §13) — the same
  // blockers the old lifecycle card listed, in the order they are cleared.
  const blockers: string[] = [];
  if (claimedTeamIds.size < MIN_CLAIMED_TEAMS) {
    blockers.push(
      claimedTeamIds.size === 0
        ? "no team can bid yet — owners claim their paddle from the live room"
        : "only one team can bid — a second owner has to claim their paddle",
    );
  }
  if ((counts?.queued ?? 0) < 1) {
    blockers.push("no players are queued");
  }

  const intakeOpen = ready.checks.some((check) => check.id === "intake_closed" && !check.pass);

  const bodies: Record<StepId, ReactNode> = {
    players: (
      <div data-testid="ready-panel">
        <ul className="as-gates">
          {ready.checks.map((check) => (
            <li key={check.id} data-testid={`check-${check.id}`} data-pass={check.pass}>
              <Badge tone={check.pass ? "success" : "warning"}>
                {check.pass ? "pass" : "fail"}
              </Badge>
              <span>{check.label}</span>
            </li>
          ))}
          {/* Not one of the gates: a shortfall does not stop an auction being
              created, it stops one being CLOSED. Stated here because this is
              where the squad minimum is decided. */}
          <li data-testid="check-squads_fillable" data-pass={feasibility.ok}>
            <Badge tone={feasibility.ok ? "success" : "warning"}>
              {feasibility.ok ? "fits" : "short"}
            </Badge>
            <span>{feasibility.headline}</span>
          </li>
        </ul>
        <div className="as-actions">
          {intakeOpen && viewer.canManage ? (
            <Button
              size="sm"
              loading={busy === "close-intake"}
              onClick={() =>
                void run(
                  "close-intake",
                  () => advanceCompetitionAction(slug, "registration_closed"),
                  "Registration closed — the pool is locked.",
                )
              }
              data-testid="setup-close-registration"
            >
              Close registration
            </Button>
          ) : null}
          <ButtonLink href={`/seasons/${slug}/registrations`} size="sm" variant="secondary">
            Review players
          </ButtonLink>
          <ButtonLink href={`/seasons/${slug}/teams`} size="sm" variant="ghost">
            Teams, captains &amp; icons
          </ButtonLink>
        </div>
      </div>
    ),
    rules: exists ? (
      <p className="as-hint">Locked at creation — they are listed under Room details below.</p>
    ) : viewer.canManage ? (
      <RulesStep slug={slug} dashboard={dashboard} />
    ) : (
      <p className="as-hint">The club&apos;s owners set the rules and create the auction.</p>
    ),
    owners: !exists ? (
      <p className="as-hint">Create the auction first — owner links belong to it.</p>
    ) : dashboard.owners === undefined ? (
      <p className="as-hint">Owners are invited by whoever runs the auction.</p>
    ) : (
      <OwnersStep
        slug={slug}
        seasonName={dashboard.competition.name}
        teams={ready.teams}
        owners={dashboard.owners}
        claimedTeamIds={claimedTeamIds}
        canManage={viewer.canManage}
        canConduct={viewer.canConduct}
      />
    ),
    lots: !exists ? (
      <p className="as-hint">
        Every approved, un-pre-signed player becomes a lot when the auction is created.
      </p>
    ) : (
      <div>
        <p className="as-hint">
          {counts === null
            ? ""
            : `${String(counts.prepared + counts.queued)} players, in registration-number order. Queued players go under the hammer one by one.`}
        </p>
        {viewer.canConduct ? (
          <div className="as-actions">
            <Button
              size="sm"
              variant={counts !== null && counts.prepared > 0 ? "primary" : "secondary"}
              loading={busy === "queue"}
              disabled={counts === null || counts.prepared === 0}
              onClick={() => void run("queue", () => queueAllLotsAction(slug), "Players queued")}
              data-testid="queue-all"
            >
              {counts !== null && counts.prepared > 0
                ? `Queue ${String(counts.prepared)} players`
                : "Everyone is queued"}
            </Button>
          </div>
        ) : null}
      </div>
    ),
    live: !exists ? (
      <p className="as-hint">
        Opens once the auction exists, two teams can bid and players are queued.
      </p>
    ) : (
      <div className="as-live">
        {dashboard.wsUrl !== null ? <ConnectionCheck wsUrl={dashboard.wsUrl} /> : null}
        {viewer.canConduct && blockers.length > 0 ? (
          <p className="as-blockers" data-testid="auction-open-blockers">
            Not ready to open: {blockers.join("; ")}.
          </p>
        ) : null}
        {viewer.canConduct && !feasibility.ok ? (
          <label className="auction-ack">
            <input
              type="checkbox"
              checked={acceptShortOpen}
              data-testid="accept-short-open"
              onChange={(event) => {
                setAcceptShortOpen(event.target.checked);
              }}
            />
            <span>
              Open anyway — {feasibility.shortfall} squad place
              {feasibility.shortfall === 1 ? "" : "s"} cannot be filled from this pool.
            </span>
          </label>
        ) : null}
        {viewer.canConduct ? (
          <div className="as-actions">
            <Button
              size="touch"
              loading={busy === "open"}
              disabled={blockers.length > 0}
              onClick={() =>
                void run(
                  "open",
                  () =>
                    auctionLifecycleAction(slug, "open", undefined, {
                      acceptShortSquads: acceptShortOpen,
                    }),
                  "The room is open",
                )
              }
              data-testid="auction-open"
            >
              Open auction
            </Button>
            <Link href={`/seasons/${slug}/auction/cockpit`} className="as-link">
              or run it from the cockpit →
            </Link>
          </div>
        ) : null}
        {viewer.canConduct ? <BroadcastLinks slug={slug} /> : null}
      </div>
    ),
  };

  return (
    <section className="as-flow" aria-labelledby="as-flow-title" data-testid="setup-flow">
      <header className="as-flow-head">
        <h2 id="as-flow-title">Get ready for auction night</h2>
        <span
          className="as-progress"
          aria-label={`${String(doneCount)} of ${String(steps.length)} steps done`}
        >
          {steps.map((step) => (
            <span key={step.id} className="as-progress-dot" data-state={step.state} />
          ))}
          <span className="as-progress-text">
            {doneCount} of {steps.length} done
          </span>
        </span>
      </header>
      <ol className="as-steps">
        {steps.map((step, index) => {
          const open = step.state !== "done" || opened.has(step.id);
          return (
            <li
              key={step.id}
              className="as-step"
              data-state={step.state}
              data-testid={`setup-step-${step.id}`}
            >
              <button
                type="button"
                className="as-step-head"
                aria-expanded={open}
                aria-controls={`as-body-${step.id}`}
                onClick={() => {
                  setOpened((current) => {
                    const next = new Set(current);
                    if (next.has(step.id)) {
                      next.delete(step.id);
                    } else {
                      next.add(step.id);
                    }
                    return next;
                  });
                }}
              >
                <span className="as-step-mark" aria-hidden>
                  {step.state === "done" ? <IconCheck size={14} /> : index + 1}
                </span>
                <span className="as-step-text">
                  <span className="as-step-title">{step.title}</span>
                  <span className="as-step-summary">{stepOf(step.id).summary}</span>
                </span>
                <span className="as-step-state">
                  {step.state === "done" ? "Done" : step.state === "current" ? "Next" : "Later"}
                </span>
              </button>
              {/* `hidden`, not unmounted: a finished step's facts stay in the
                  page for anyone (or any test) who reads them. */}
              <div className="as-step-body" id={`as-body-${step.id}`} hidden={!open}>
                {bodies[step.id]}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
