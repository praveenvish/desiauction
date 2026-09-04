"use client";

import {
  TARGET_PRIORITIES,
  TARGET_PRIORITY_LABELS,
  evaluatePlan,
  formatPaiseINR,
  paise,
  type AuctionStatus,
  type PlanState,
  type TargetState,
} from "@desiauction/core";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PlayerImage,
  Select,
  useAnnouncer,
  type BadgeTone,
} from "@desiauction/ui";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { roleLabel } from "../../../../../lib/playing-roles";
import type { PlanLotRow, TargetRow } from "../../../../../server/auction/owner-plan";
import {
  addTargetAction,
  removeTargetAction,
  updateTargetAction,
  type PlanMutationResult,
  type PlanView,
} from "../../../../../server/auction/owner-plan-actions";
import {
  fitBadge,
  groupByPriority,
  outcomeBadge,
  refusalMessage,
  roleFacts,
  rupeesFromPaise,
  searchPool,
} from "./plan-model";
import { PlanReportCard } from "./plan-report";

/**
 * MY PLAN — the page (WR-1).
 *
 * Three inputs and nothing else: add a player, type a max if you have one,
 * pick a backup if you want one. Priority defaults to "Target" and only shows
 * itself once there is something to rank. The page states where the plan
 * stands against the purse in the owner's own numbers and never proposes a
 * price for anyone.
 *
 * The fold runs HERE on every change (`evaluatePlan` is pure and the same
 * function the server ran for the first paint), so a save never waits on a
 * second round trip to show its consequence. Errors render beside the field
 * that owns them — a toast that vanishes is the wrong place for "below base".
 */

const STATUS_BADGE: Record<AuctionStatus, { tone: BadgeTone; label: string }> = {
  scheduled: { tone: "neutral", label: "Scheduled" },
  live: { tone: "live", label: "Live" },
  paused: { tone: "warning", label: "Paused" },
  completed: { tone: "success", label: "Completed" },
  reconciled: { tone: "success", label: "Settled" },
  abandoned: { tone: "neutral", label: "Abandoned" },
};

function money(value: number): string {
  return formatPaiseINR(paise(value));
}

function signedMoney(value: number): string {
  return value < 0 ? `−${money(-value)}` : money(value);
}

function nameOf(lot: PlanLotRow | undefined, fallback: string): string {
  return lot?.playerName ?? lot?.lotNumber ?? fallback;
}

export function PlanPanel({ slug, view }: { slug: string; view: PlanView }) {
  const announce = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [targets, setTargets] = useState<TargetRow[]>(view.targets);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.targets.map((row) => [row.id, rupeesFromPaise(row.maxBid)])),
  );
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const lotsByRegistration = useMemo(
    () => new Map(view.lots.map((lot) => [lot.registrationId, lot])),
    [view.lots],
  );
  const rowsByRegistration = useMemo(
    () => new Map(targets.map((row) => [row.registrationId, row])),
    [targets],
  );
  const targeted = useMemo(() => new Set(targets.map((row) => row.registrationId)), [targets]);
  const state: PlanState = useMemo(
    () =>
      evaluatePlan({
        targets,
        lots: view.lots,
        myTeamId: view.team.id,
        purseRemaining: paise(view.standing.purseRemaining),
        squadSize: view.standing.squadSize,
        rules: view.planRules,
        currentLot: null,
      }),
    [targets, view],
  );
  const groups = useMemo(() => groupByPriority(state.targets), [state.targets]);
  const results = useMemo(
    () => searchPool(view.lots, targeted, query),
    [view.lots, targeted, query],
  );
  const purseLabel = money(view.planRules.pursePerTeam);
  const roles = useMemo(
    () => roleFacts(view.lots, view.preSignedRoles, view.team.id),
    [view.lots, view.preSignedRoles, view.team.id],
  );
  const roleLine = (counts: { role: string; count: number }[]) =>
    counts
      .map(({ role, count }) => `${String(count)} ${roleLabel(role)}${count === 1 ? "" : "s"}`)
      .join(" · ");

  const settle = (
    result: PlanMutationResult,
    onOk: (targets: TargetRow[]) => void,
    onError: (message: string) => void,
    context: { basePrice?: string } = {},
  ) => {
    if (result.ok) {
      onOk(result.targets);
      return;
    }
    onError(refusalMessage(result.reason, { ...context, purse: purseLabel }));
  };

  const add = (lot: PlanLotRow) => {
    setAddError(null);
    setBusy(lot.registrationId);
    startTransition(async () => {
      const result = await addTargetAction(slug, view.team.id, {
        registrationId: lot.registrationId,
        maxRupees: "",
        priority: 3,
        fallbackRegistrationId: null,
        atSeq: null,
      });
      setBusy(null);
      settle(
        result,
        (next) => {
          setTargets(next);
          setDrafts((current) => ({
            ...current,
            ...Object.fromEntries(
              next
                .filter((row) => !(row.id in current))
                .map((row) => [row.id, rupeesFromPaise(row.maxBid)]),
            ),
          }));
          setQuery("");
          announce(`${nameOf(lot, "Player")} added to your plan`, "polite");
        },
        setAddError,
      );
    });
  };

  const save = (
    row: TargetRow,
    patch: { maxRupees?: string; priority?: number; fallback?: string | null },
  ) => {
    const lot = lotsByRegistration.get(row.registrationId);
    setBusy(row.id);
    startTransition(async () => {
      const result = await updateTargetAction(slug, view.team.id, row.id, {
        maxRupees: patch.maxRupees ?? drafts[row.id] ?? rupeesFromPaise(row.maxBid),
        priority: patch.priority ?? row.priority,
        fallbackRegistrationId:
          patch.fallback === undefined ? row.fallbackRegistrationId : patch.fallback,
        atSeq: null,
      });
      setBusy(null);
      settle(
        result,
        (next) => {
          setTargets(next);
          const saved = next.find((entry) => entry.id === row.id);
          if (saved !== undefined) {
            setDrafts((current) => ({ ...current, [row.id]: rupeesFromPaise(saved.maxBid) }));
          }
          setRowErrors((current) =>
            Object.fromEntries(Object.entries(current).filter(([key]) => key !== row.id)),
          );
          announce(`Saved ${nameOf(lot, "player")}`, "polite");
        },
        (message) => {
          setRowErrors((current) => ({ ...current, [row.id]: message }));
        },
        lot === undefined ? {} : { basePrice: money(lot.basePrice) },
      );
    });
  };

  const remove = (row: TargetRow) => {
    const lot = lotsByRegistration.get(row.registrationId);
    setBusy(row.id);
    startTransition(async () => {
      const result = await removeTargetAction(slug, view.team.id, row.id, null);
      setBusy(null);
      settle(
        result,
        (next) => {
          setTargets(next);
          announce(`${nameOf(lot, "Player")} removed from your plan`, "polite");
        },
        (message) => {
          setRowErrors((current) => ({ ...current, [row.id]: message }));
        },
      );
    });
  };

  const status = STATUS_BADGE[view.auctionStatus];
  const fit = fitBadge(state.budget.fit);
  const recover = state.suggestions.find((s) => s.kind === "recover");
  const overSlots = state.suggestions.find((s) => s.kind === "over_slots");
  const unaffordable = state.suggestions.filter((s) => s.kind === "unaffordable");

  return (
    <div
      className="plan-panel"
      data-testid="plan-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <header className="dash-head">
        <div className="competition-title-row">
          <h1>My plan</h1>
          <Badge tone={status.tone} data-testid="plan-auction-status">
            {status.label}
          </Badge>
        </div>
        <p className="competitions-hint">
          {view.team.name} · {view.competition.name}. Only you and this team&apos;s other owners can
          see it.{" "}
          {view.readOnly
            ? "The auction is over; this is the plan as it stood."
            : "Add the players you want. A max is optional."}
        </p>
        {view.teams.length > 1 ? (
          <nav className="plan-teams" aria-label="Your teams">
            {view.teams.map((team) => (
              <Link
                key={team.id}
                href={`/seasons/${slug}/auction/plan?team=${team.id}`}
                aria-current={team.id === view.team.id ? "page" : undefined}
                className="plan-team-link"
              >
                {team.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="stat-row plan-stats">
        <div className="stat-tile" data-testid="plan-purse">
          <span className="stat-value">{money(state.budget.purseRemaining)}</span>
          <span className="stat-label">Purse remaining</span>
        </div>
        <div className="stat-tile" data-testid="plan-exposure">
          <span className="stat-value">{money(state.budget.plannedExposure)}</span>
          <span className="stat-label">
            Planned for {state.budget.openTargets}{" "}
            {state.budget.openTargets === 1 ? "target" : "targets"}
          </span>
        </div>
        <div className="stat-tile" data-testid="plan-headroom">
          <span className="stat-value">{signedMoney(state.budget.headroom)}</span>
          <span className="stat-label">Headroom</span>
        </div>
      </div>

      {/* Phase 1.5: two counts, stated. Which roles a squad NEEDS stays the owner's
          call — this line never says "you need". */}
      <p className="plan-roles" data-testid="plan-roles">
        <span>
          <span className="plan-roles-label">Squad</span> {roleLine(roles.squad)}
        </span>
        <span>
          <span className="plan-roles-label">Still to come</span> {roleLine(roles.remaining)}
        </span>
      </p>

      <div className="plan-fit" data-testid="plan-fit" data-fit={state.budget.fit}>
        <Badge tone={fit.tone}>{fit.label}</Badge>
        {recover?.kind === "recover" ? (
          <p className="plan-note">
            To fit, the plan needs {money(recover.amount)} less.{" "}
            {recover.candidates.length > 0 ? (
              <>
                Lowest priority first:{" "}
                {recover.candidates
                  .map(
                    (c) =>
                      `${nameOf(lotsByRegistration.get(c.registrationId), "a player")} (${money(c.plannedAmount)})`,
                  )
                  .join(", ")}
                .
              </>
            ) : null}
          </p>
        ) : null}
        {overSlots?.kind === "over_slots" ? (
          <p className="plan-note">
            {overSlots.excess} more open {overSlots.excess === 1 ? "target" : "targets"} than squad
            places ({view.planRules.squadMax} max).
          </p>
        ) : null}
        {unaffordable.map((s) => (
          <p className="plan-note" key={s.registrationId}>
            {nameOf(lotsByRegistration.get(s.registrationId), "A player")} is planned at{" "}
            {money(s.plannedAmount)}, above what you could bid right now ({money(s.maxAffordable)}
            ).
          </p>
        ))}
      </div>

      {view.report !== undefined ? (
        <PlanReportCard report={view.report} lotsByRegistration={lotsByRegistration} />
      ) : null}

      {view.readOnly ? null : (
        <Card data-testid="plan-add">
          <h2>Add a player</h2>
          <Field
            label="Search the auction"
            placeholder="Name, number or role"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            data-testid="plan-search"
          />
          {query.trim() === "" ? null : results.length === 0 ? (
            <p className="plan-hint">
              No one matches &ldquo;{query.trim()}&rdquo;
              {targeted.size > 0 ? " who isn't already on your plan" : ""}.
            </p>
          ) : (
            <ul className="plan-search-results" data-testid="plan-search-results">
              {results.map((lot) => (
                <li key={lot.registrationId} className="plan-result">
                  <Identity lot={lot} media={view.lotMedia[lot.lotId]} />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    loading={busy === lot.registrationId}
                    onClick={() => {
                      add(lot);
                    }}
                    data-testid={`plan-add-${lot.registrationId}`}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {addError !== null ? (
            <p className="plan-hint" role="alert" data-testid="plan-add-error">
              {addError}
            </p>
          ) : null}
        </Card>
      )}

      {targets.length === 0 ? (
        <EmptyState
          title="No targets yet"
          description={
            view.readOnly
              ? "This team made no plan."
              : "Search above for a player and add them. A max is optional."
          }
        />
      ) : (
        groups.map((group) => (
          <section
            key={group.priority}
            className="plan-group"
            data-testid={`plan-group-${String(group.priority)}`}
          >
            <h2>
              {group.label} <span className="plan-count">{group.items.length}</span>
            </h2>
            <ul className="plan-list">
              {group.items.map((target) => {
                const row = rowsByRegistration.get(target.registrationId);
                if (row === undefined) {
                  return null;
                }
                return (
                  <TargetLine
                    key={row.id}
                    target={target}
                    row={row}
                    lot={lotsByRegistration.get(target.registrationId)}
                    media={target.lotId === null ? undefined : view.lotMedia[target.lotId]}
                    lots={view.lots}
                    lotsByRegistration={lotsByRegistration}
                    draft={drafts[row.id] ?? rupeesFromPaise(row.maxBid)}
                    error={rowErrors[row.id] ?? null}
                    disabled={view.readOnly}
                    busy={busy === row.id}
                    pending={pending}
                    onDraft={(value) => {
                      setDrafts((current) => ({ ...current, [row.id]: value }));
                    }}
                    onSave={(patch) => {
                      save(row, patch);
                    }}
                    onRemove={() => {
                      remove(row);
                    }}
                  />
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function Identity({
  lot,
  media,
}: {
  lot: PlanLotRow;
  media: { photoUrl: string | null; number: string | null } | undefined;
}) {
  const name = nameOf(lot, lot.lotNumber);
  return (
    <div className="plan-identity">
      <PlayerImage
        name={name}
        seed={lot.registrationId}
        size="sm"
        {...(media?.photoUrl ? { src: media.photoUrl } : {})}
      />
      <div className="plan-identity-text">
        <span className="registration-name">{name}</span>
        <span className="plan-sub">
          {lot.number} · {roleLabel(lot.role)} · base {money(lot.basePrice)}
        </span>
      </div>
    </div>
  );
}

function TargetLine({
  target,
  row,
  lot,
  media,
  lots,
  lotsByRegistration,
  draft,
  error,
  disabled,
  busy,
  pending,
  onDraft,
  onSave,
  onRemove,
}: {
  target: TargetState;
  row: TargetRow;
  lot: PlanLotRow | undefined;
  media: { photoUrl: string | null; number: string | null } | undefined;
  lots: PlanLotRow[];
  lotsByRegistration: Map<string, PlanLotRow>;
  draft: string;
  error: string | null;
  disabled: boolean;
  busy: boolean;
  pending: boolean;
  onDraft: (value: string) => void;
  onSave: (patch: { maxRupees?: string; priority?: number; fallback?: string | null }) => void;
  onRemove: () => void;
}) {
  const badge = outcomeBadge(target.outcome);
  const open = target.outcome === "open";
  const locked = disabled || !open;
  const id = row.registrationId;
  const backupName =
    target.effectiveBackup === null
      ? null
      : nameOf(lotsByRegistration.get(target.effectiveBackup), "a backup");
  return (
    <li className="plan-row" data-testid={`plan-target-${id}`} data-outcome={target.outcome}>
      <div className="plan-row-head">
        {lot !== undefined ? (
          <Identity lot={lot} media={media} />
        ) : (
          <div className="plan-identity">
            <div className="plan-identity-text">
              <span className="registration-name">Player no longer in this auction</span>
            </div>
          </div>
        )}
        <div className="plan-row-marks">
          {badge !== null ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
          {target.paidAmount !== null ? (
            <span className="plan-sub">for {money(target.paidAmount)}</span>
          ) : null}
        </div>
      </div>
      <div className="plan-row-controls">
        <Field
          label="Max (₹)"
          inputMode="numeric"
          autoComplete="off"
          placeholder="No cap"
          value={draft}
          disabled={locked || pending}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          onBlur={() => {
            if (draft !== rupeesFromPaise(row.maxBid)) {
              onSave({ maxRupees: draft });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          {...(error !== null ? { error } : {})}
          {...(target.countedAtBase && open && target.basePrice !== null
            ? { help: `Counted at base, ${money(target.basePrice)}` }
            : target.ladderFloor !== null && target.maxBid !== null
              ? {
                  help: `Not on the bid ladder — the last legal bid under it is ${money(target.ladderFloor)}`,
                }
              : {})}
          data-testid={`plan-max-${id}`}
        />
        <Select
          label="Priority"
          value={String(row.priority)}
          disabled={locked || pending}
          onChange={(event) => {
            onSave({ priority: Number(event.target.value) });
          }}
          data-testid={`plan-priority-${id}`}
        >
          {TARGET_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {TARGET_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </Select>
        <Select
          label="Backup"
          value={row.fallbackRegistrationId ?? ""}
          disabled={locked || pending}
          onChange={(event) => {
            onSave({ fallback: event.target.value === "" ? null : event.target.value });
          }}
          {...(backupName !== null ? { help: `Next: ${backupName}` } : {})}
          data-testid={`plan-backup-${id}`}
        >
          <option value="">No backup</option>
          {lots
            .filter((candidate) => candidate.registrationId !== id)
            .map((candidate) => (
              <option key={candidate.registrationId} value={candidate.registrationId}>
                {nameOf(candidate, candidate.lotNumber)} · {candidate.number}
              </option>
            ))}
        </Select>
        {disabled ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="plan-remove"
            disabled={pending}
            loading={busy}
            onClick={onRemove}
            data-testid={`plan-remove-${id}`}
          >
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}
