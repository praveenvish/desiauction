"use client";

import Link from "next/link";
import {
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  Field,
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconGavel,
  IconKebab,
  IconLedger,
  IconLock,
  IconPlus,
  IconRupee,
  IconShieldCheck,
  IconUsers,
  initialsFor,
  type KitTone,
  paintOnFill,
  Pill,
  PopoverMenu,
  SectionCard,
  Select,
  useAnnouncer,
  useToast,
  VisuallyHidden,
  TeamShield,
  useTeamBadge,
} from "@desiauction/ui";
import { useRef, useState, type ReactNode, type RefObject } from "react";

import {
  attestCaptureAction,
  closeCaseAction,
  computeObligationsAction,
  openCaseAction,
  recordPaymentAction,
  refundPaymentAction,
  reopenCaseAction,
  settleCaseAction,
  verifyCaseAction,
  voidCaseAction,
  waiveObligationAction,
  type ActionResult,
  type ConsoleTeam,
  type ConsoleView,
} from "../../../../server/settlement/actions";
import type { CaseView, ObligationView, PaymentView } from "../../../../server/settlement/views";
import { CrestImage } from "../../../../components/team/crest-image";
import { formatDateTime } from "../../../../lib/format-date";
import { useOutcomeFocus } from "../../../../lib/use-outcome-focus";
import { ledgerINR } from "../../../../lib/inr";
import { CASE_STATE, PAYMENT_STATE } from "./money-words";
import "./money.css";
import "./season-money.css";
import { useHydrated } from "../../../../lib/use-hydrated";
import { release } from "../../../../lib/release";

/**
 * PX-7 E1 — the Settlement console.
 *
 * The post-gavel workflow, one legal step at a time. Every button here maps to
 * exactly one certified writer command; nothing on this screen decides whether
 * a step is allowed — the case's own status does, and the writer re-decides it
 * server-side regardless of what this component renders. A disabled button is a
 * courtesy, never a control.
 *
 * THE REDESIGN (2026-09-27). It was six stacked cards: four figure tiles, a
 * case card whose stepper said "Settle" beside a "Settled" badge, a separate
 * next-step card, a team table, a payment table and "Controller actions" — and
 * the case id and date were said twice. Now: ONE hero (where the case is, how
 * much is in, the one next step), the teams as cards with their own bars, the
 * payments as a list, and the rare audited acts (reopen, void) in the hero's ⋯.
 * Every command, confirm and reason is exactly what it was.
 */

const STATUS_TONE: Record<string, KitTone> = {
  opened: "blue",
  verified: "blue",
  discrepant: "red",
  settling: "amber",
  settled: "green",
  closed: "green",
  voided: "neutral",
};

/** The lifecycle as an organizer walks it. `discrepant` is a detour off `verify`. */
const STEPS: { key: string; label: string }[] = [
  { key: "opened", label: "Open" },
  { key: "verified", label: "Verify" },
  { key: "settling", label: "Collect" },
  { key: "settled", label: "Settle" },
  { key: "closed", label: "Close" },
];

const STEP_ORDER: Record<string, number> = {
  opened: 0,
  discrepant: 1,
  verified: 1,
  settling: 2,
  settled: 3,
  closed: 4,
  voided: -1,
};

const METHODS: { value: string; label: string }[] = [
  { value: "manual:cash", label: "Cash" },
  { value: "manual:upi-direct", label: "UPI (direct)" },
  { value: "manual:bank", label: "Bank transfer" },
];

/** Keyed loosely on purpose: the payment status arrives as projection text. */
const PAYMENT_TONE: Record<string, KitTone> = {
  created: "blue",
  authorized: "blue",
  captured: "green",
  refunded: "neutral",
  failed: "red",
  disputed: "amber",
};

type Act = (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;

/** Money always renders with its exact value inspectable (C-7). */
function Amount({ value, label }: { value: number; label?: string }) {
  return (
    <span
      title={`${String(value)} paise`}
      aria-label={label === undefined ? undefined : `${label}: ${ledgerINR(value)}`}
    >
      {ledgerINR(value)}
    </span>
  );
}

/** A share of a whole as a bar. Decorative: the figure beside it says the same in words. */
function Bar({ share, tone }: { share: number; tone: "gold" | "green" }) {
  const pct = Math.max(0, Math.min(100, share * 100));
  return (
    <span className="mn-bar" data-tone={tone} aria-hidden>
      <span style={{ inlineSize: `${String(pct)}%` }} />
    </span>
  );
}

/** A team's mark: its crest, else its initials on its own colour — as on the Teams tab. */
function TeamMark({
  team,
  name,
  size,
}: {
  team: ConsoleTeam | undefined;
  name: string;
  size: 40 | 30;
}) {
  const badge = useTeamBadge();
  if ((team?.logoUrl ?? null) === null && badge === "shield") {
    // 0111: the season's default team logo.
    return (
      <TeamShield
        initials={initialsFor(name).initials ?? "?"}
        color={team?.primaryColor ?? null}
        size={size}
      />
    );
  }
  const mono = (
    <span
      className="mn-mark"
      data-size={size}
      style={paintOnFill(team?.primaryColor ?? null)}
      aria-hidden
    >
      {initialsFor(name).initials ?? "?"}
    </span>
  );
  const src = team?.logoUrl ?? null;
  return src !== null ? (
    <CrestImage
      className="mn-mark"
      data-size={size}
      src={src}
      width={size}
      height={size}
      loading="lazy"
      fallback={mono}
    />
  ) : (
    mono
  );
}

function CaseStepper({ status }: { status: string }) {
  const at = STEP_ORDER[status] ?? -1;
  if (status === "voided") {
    return null;
  }
  /**
   * `closed` is the LAST step, not a step still being worked. The old rule —
   * `index < at ? done : index === at ? current` — could never tick index 4,
   * so a sealed, replay-verified case rendered "✓ Open · ✓ Verify · ✓ Collect ·
   * ✓ Settle · 5 Close" for ever: four-fifths finished, permanently, on the one
   * status that means finished. A terminal status has no current step.
   *
   * `settled` means the Settle step is DONE and Close is the one being worked:
   * the stepper used to mark "Settle" as current beside a "Settled" badge.
   */
  const finished = status === "closed";
  const current = status === "settled" ? at + 1 : at;
  return (
    <ol className="mn-stepper" data-testid="case-stepper" aria-label="Settlement progress">
      {STEPS.map((step, index) => {
        const state =
          finished || index < current ? "done" : index === current ? "current" : "blocked";
        return (
          <li
            key={step.key}
            className="mn-step"
            data-state={state}
            data-step={step.key}
            {...(state === "current" ? { "aria-current": "step" as const } : {})}
          >
            <span className="mn-step-mark" aria-hidden>
              {state === "done" ? <IconCheck size={12} /> : null}
            </span>
            <span className="mn-step-label">
              {step.label}
              {state === "done" ? <VisuallyHidden> (done)</VisuallyHidden> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function MoneyPanel({ slug, console: view }: { slug: string; console: ConsoleView }) {
  const toast = useToast();
  const announce = useAnnouncer();
  const [busy, setBusy] = useState(false);
  // Focus lands on the outcome once the refresh has committed — see
  // `use-outcome-focus`, shared with the org money desks.
  const { outcome, report, ref: outcomeRef } = useOutcomeFocus();
  // A click before hydration is a no-op; the surface says when it is live.
  const hydrated = useHydrated();

  /**
   * One command runner: every action reports, then re-reads the server truth.
   *
   * Two things happen here that did not before. Focus MOVES to the sentence
   * describing what just happened — measured, focus returned to `<body>` after
   * every successful action, so a keyboard user was dropped at the top of the
   * document with no idea whether ₹1,20,000 had moved. And a REFUSAL is
   * announced assertively: the toast region is `role="status" aria-live="polite"`
   * and queues behind whatever is already speaking, which is the wrong urgency
   * for "that payment was rejected".
   */
  const act: Act = async (run, done) => {
    setBusy(true);
    const result = await release(run(), () => {
      setBusy(false);
    });
    if (result.ok) {
      toast({ title: done, tone: "success" });
      report(done, true);
      return true;
    }
    toast({ title: result.error, tone: "danger" });
    announce(result.error, "assertive");
    report(result.error, false);
    return false;
  };

  const outcomeNote =
    outcome === null ? null : (
      <p className="money-result" tabIndex={-1} ref={outcomeRef} data-testid="money-result">
        {outcome.text}
      </p>
    );

  const { competition, auction, case: settlementCase, teams, readiness, viewer } = view;

  if (auction === null) {
    return (
      <div data-testid="money-panel" data-hydrated={hydrated ? "true" : "false"}>
        <EmptyCard
          icon={<IconGavel size={26} />}
          title="Settlement opens after the auction"
          body="There is no auction for this season yet. Once the auction is created, conducted and completed, its settlement case opens here."
          action={
            <ButtonLink href={`/seasons/${slug}/auction`} size="sm">
              Go to the auction
            </ButtonLink>
          }
        />
      </div>
    );
  }

  if (settlementCase === null) {
    return (
      <div data-testid="money-panel" data-hydrated={hydrated ? "true" : "false"}>
        <OpenCase
          slug={slug}
          auctionStatus={auction.status}
          teams={teams}
          canManage={viewer.canManage}
          busy={busy}
          act={act}
        />
      </div>
    );
  }

  const byId = new Map(teams.map((team) => [team.id, team]));

  return (
    <div data-testid="money-panel" data-hydrated={hydrated ? "true" : "false"}>
      <CaseHero
        slug={slug}
        settlementCase={settlementCase}
        readiness={readiness}
        viewer={viewer}
        competitionName={competition.name}
        busy={busy}
        act={act}
      />

      {outcomeNote}

      <Teams
        slug={slug}
        settlementCase={settlementCase}
        teams={byId}
        viewer={viewer}
        busy={busy}
        act={act}
      />

      {/* Always rendered once there is a case: "no payments yet" is a fact worth
          stating, and its absence made a case with no money look unfinished. */}
      <Payments
        slug={slug}
        settlementCase={settlementCase}
        teams={byId}
        canCollect={viewer.canCollect}
        canOverride={viewer.canOverride}
        busy={busy}
        act={act}
      />
    </div>
  );
}

// --- Open ---------------------------------------------------------------------------

function OpenCase({
  slug,
  auctionStatus,
  teams,
  canManage,
  busy,
  act,
}: {
  slug: string;
  auctionStatus: string;
  teams: readonly { id: string; name: string }[];
  canManage: boolean;
  busy: boolean;
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
}) {
  const [basis, setBasis] = useState("committed");
  const [fixed, setFixed] = useState<Record<string, string>>({});

  // The writer refuses a case on an unfinished auction (`auction_not_final`).
  // Saying so BEFORE the click is the whole point of a console.
  if (auctionStatus !== "completed" && auctionStatus !== "reconciled") {
    return (
      <EmptyCard
        icon={<IconGavel size={26} />}
        title="The auction has not finished"
        body="A settlement case can only open on a completed auction — that is what freezes the log the money is worked out from. Close the auction first."
        action={
          <ButtonLink href={`/seasons/${slug}/auction`} size="sm">
            Go to the auction
          </ButtonLink>
        }
      />
    );
  }

  if (!canManage) {
    return (
      <EmptyCard
        icon={<IconLock size={26} />}
        title="No settlement case yet"
        body="The auction is finished and ready to settle, but you do not have permission to open the case. Ask an organization owner for a settlement grant."
      />
    );
  }

  return (
    <SectionCard
      icon={<IconShieldCheck />}
      title="Open the settlement case"
      description="Opening the case pins the auction log exactly as it stands now. Everything owed is worked out from that pin, and it never moves again."
    >
      <div className="money-form mn-form">
        <Select
          label="How are the dues worked out?"
          value={basis}
          onChange={(event) => {
            setBasis(event.target.value);
          }}
          data-testid="basis-select"
        >
          <option value="committed">From what each team committed in the auction</option>
          <option value="fixed">From fixed amounts I enter now</option>
          <option value="none">Nothing is owed</option>
        </Select>
        <Button
          onClick={() => {
            void act(() => openCaseAction(slug, basis, fixed), "Case opened.");
          }}
          disabled={busy}
          size="touch"
          data-testid="open-case"
        >
          Open case
        </Button>
      </div>
      {basis === "fixed" ? (
        <fieldset className="fixed-dues mn-fixed">
          <legend>What each team owes</legend>
          {teams.length === 0 ? (
            <p className="section-note">This season has no teams to charge.</p>
          ) : (
            teams.map((team) => (
              <Field
                key={team.id}
                label={`${team.name} owes (₹)`}
                inputMode="decimal"
                placeholder="0"
                value={fixed[team.id] ?? ""}
                onChange={(event) => {
                  setFixed((current) => ({ ...current, [team.id]: event.target.value }));
                }}
                data-testid={`fixed-${team.id}`}
              />
            ))
          )}
        </fieldset>
      ) : null}
    </SectionCard>
  );
}

/** The product's one EmptyState, inside the Settlement card. */
function EmptyCard({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <SectionCard icon={<IconRupee />} title="Settlement">
      <EmptyState
        icon={icon}
        title={title}
        description={body}
        {...(action !== undefined ? { action } : {})}
      />
    </SectionCard>
  );
}

// --- The hero: where the case is, how much is in, the one next step ----------------

const BASIS: Record<string, string> = {
  committed: "dues from what teams committed in the auction",
  fixed: "dues fixed when the case opened",
};

function CaseHero({
  slug,
  settlementCase,
  readiness,
  viewer,
  competitionName,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  readiness: { ready: boolean; status: string; blockers: readonly string[] } | null;
  viewer: ConsoleView["viewer"];
  competitionName: string;
  busy: boolean;
  act: Act;
}) {
  const { financial, status } = settlementCase;
  const total = financial.totalObligations;
  const owing = settlementCase.obligations.filter((obligation) => obligation.outstanding > 0);
  const accounted = total > 0 ? (financial.discharged + financial.waived) / total : 0;
  const tone = STATUS_TONE[status] ?? "neutral";

  const say =
    status === "voided"
      ? "This case was voided. It settles nothing and moves no money."
      : settlementCase.obligations.length === 0
        ? "Nothing is owed yet — the dues are worked out once the case is verified."
        : financial.outstanding > 0
          ? `${ledgerINR(financial.outstanding)} still to collect, from ${String(owing.length)} team${owing.length === 1 ? "" : "s"}.`
          : financial.waived > 0
            ? `Every rupee is accounted for — ${ledgerINR(financial.waived)} waived, nothing outstanding.`
            : "Every rupee is in — nothing waived, nothing outstanding.";

  return (
    <section className="mn-hero" data-status={status} aria-label="Settlement case">
      <div className="mn-hero-top">
        <CaseStepper status={status} />
        <Pill tone={tone} dot testId="case-status">
          {CASE_STATE[status] ?? status}
        </Pill>
        <span className="mn-hero-spacer" />
        <Link
          className="st-link mn-review-link"
          href={`/seasons/${slug}/money/case/${settlementCase.caseId}`}
        >
          Open the case review
          <IconArrowRight size={16} aria-hidden />
        </Link>
        {viewer.canOverride ? (
          <CaseMenu
            slug={slug}
            settlementCase={settlementCase}
            competitionName={competitionName}
            busy={busy}
            act={act}
          />
        ) : null}
      </div>

      <div className="mn-hero-figure">
        <p className="mn-headline">
          <Amount value={financial.discharged} />{" "}
          <span className="mn-headline-of">
            collected of <Amount value={total} />
          </span>
        </p>
        <p className="mn-say" data-tone={financial.outstanding > 0 ? "owed" : "clear"}>
          {say}
        </p>
        {total > 0 ? (
          <Bar share={accounted} tone={financial.outstanding > 0 ? "gold" : "green"} />
        ) : null}
      </div>

      {/* The four figures, said once. They were four tiles the size of the hero. */}
      <dl className="mn-figures">
        <div>
          <dt>Dues</dt>
          <dd data-testid="total-obligations">
            <Amount value={total} />
          </dd>
        </div>
        <div>
          <dt>Collected</dt>
          <dd data-testid="discharged">
            <Amount value={financial.discharged} />
          </dd>
        </div>
        <div>
          <dt>Waived</dt>
          <dd data-testid="waived">
            <Amount value={financial.waived} />
          </dd>
        </div>
        <div data-owed={financial.outstanding > 0 ? "" : undefined}>
          <dt>Outstanding</dt>
          <dd data-testid="outstanding">
            <Amount value={financial.outstanding} />
          </dd>
        </div>
        {/* Recorded but not yet attested. Without it, writing ₹10,000.50 against a
            ₹25,000 due changed no figure and no row — the money was simply invisible. */}
        {settlementCase.pending > 0 ? (
          <div>
            <dt>Awaiting confirmation</dt>
            <dd data-testid="pending">
              <Amount value={settlementCase.pending} />
            </dd>
          </div>
        ) : null}
      </dl>

      <NextStep
        slug={slug}
        settlementCase={settlementCase}
        readiness={readiness}
        viewer={viewer}
        busy={busy}
        act={act}
      />

      {/* The case's identity, said once and quietly: number, date, what it stands on. */}
      <p className="mn-identity" data-testid="case-identity">
        Case <span className="digest">{settlementCase.caseId.slice(-8)}</span> · opened{" "}
        {formatDateTime(settlementCase.openedAt)}
        {BASIS[settlementCase.basis] !== undefined
          ? ` · ${BASIS[settlementCase.basis] ?? ""}`
          : " · nothing owed"}
      </p>
    </section>
  );
}

/** The next step's own band inside the hero: what it is, why, and the button. */
function Next({
  tone,
  icon,
  title,
  children,
}: {
  tone: KitTone;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mn-next" data-tone={tone}>
      <h2 className="mn-next-title">
        <span className="mn-next-icon" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function focusCollect() {
  const select = document.querySelector<HTMLSelectElement>('[data-testid="pay-team"]');
  select?.scrollIntoView({ block: "center" });
  select?.focus();
}

function NextStep({
  slug,
  settlementCase,
  readiness,
  viewer,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  readiness: { ready: boolean; status: string; blockers: readonly string[] } | null;
  viewer: ConsoleView["viewer"];
  busy: boolean;
  act: Act;
}) {
  const [reason, setReason] = useState("");
  /**
   * P0-3: Settle and Close shipped with NO confirmation at all — measured
   * `dialog appeared: false` for both — while Waive, which reverses ₹4,999,
   * had a full modal with two required fields. Closing seals evidence for
   * ever. The risk calibration was exactly inverted; this restores it, in the
   * shape commit 5518fc2 landed for auction completion.
   */
  const [confirming, setConfirming] = useState<"settle" | "close" | null>(null);
  const caseId = settlementCase.caseId;

  if (settlementCase.status === "opened") {
    return (
      <Next
        tone="blue"
        icon={<IconShieldCheck size={18} />}
        title="Verify the case against the auction"
      >
        <p className="section-note">
          Verification re-reads the frozen auction log and checks it still matches the pin taken
          when the case opened. Nothing moves until it does.
        </p>
        {viewer.canManage ? (
          <div className="mn-step-actions">
            <Button
              onClick={() => {
                void act(() => verifyCaseAction(slug, caseId), "Verified against the auction log.");
              }}
              disabled={busy}
              data-testid="verify-case"
              size="touch"
            >
              Verify case
            </Button>
          </div>
        ) : (
          <p className="section-note">You need a settlement grant to verify this case.</p>
        )}
      </Next>
    );
  }

  if (settlementCase.status === "discrepant") {
    return (
      <Next tone="red" icon={<IconAlert size={18} />} title="The auction log no longer matches">
        <p className="section-note">
          What the auction log says today is not what this case pinned when it opened. Money is
          frozen: nothing can be collected, waived or closed while the case is discrepant. Verifying
          again adopts the log as it stands now — that is an override and is recorded against your
          name.
        </p>
        {viewer.canOverride ? (
          <div className="money-form mn-form">
            <Field
              label="Why are you adopting the new log?"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              required
              data-testid="discrepancy-reason"
            />
            <Button
              variant="danger"
              onClick={() => {
                void act(
                  () => verifyCaseAction(slug, caseId, reason),
                  "Re-verified. The case adopted the current log.",
                );
              }}
              disabled={busy || reason.trim() === ""}
              data-testid="reverify-case"
            >
              Re-verify (override)
            </Button>
          </div>
        ) : (
          <p className="section-note">Only a settlement controller can resolve a discrepancy.</p>
        )}
      </Next>
    );
  }

  if (settlementCase.status === "verified") {
    return (
      <Next tone="blue" icon={<IconUsers size={18} />} title="Work out what each team owes">
        <p className="section-note">
          This turns the verified auction into a due for every team. It is the last step before
          money can be collected.
        </p>
        {viewer.canManage ? (
          <div className="mn-step-actions">
            <Button
              onClick={() => {
                void act(() => computeObligationsAction(slug, caseId), "Obligations computed.");
              }}
              disabled={busy}
              data-testid="compute-obligations"
              size="touch"
            >
              Compute obligations
            </Button>
          </div>
        ) : (
          <p className="section-note">You need a settlement grant to compute obligations.</p>
        )}
      </Next>
    );
  }

  if (settlementCase.status === "settling") {
    const clear = settlementCase.financial.outstanding === 0;
    const pending = settlementCase.pending;
    return (
      /*
       * The headline used to read "Everything is accounted for" directly
       * under a COLLECTING badge — a contradiction in one glance. The case IS
       * still collecting; what has changed is that nothing is outstanding.
       */
      <Next
        tone={clear ? "green" : "amber"}
        icon={clear ? <IconCheck size={18} /> : <IconRupee size={18} />}
        title={clear ? "Nothing is outstanding — ready to settle" : "Collect what is still owed"}
      >
        <p className="section-note">
          {clear
            ? "Settling locks the amounts so they can no longer change. Closing, the step after it, runs the financial verification and seals the evidence."
            : "Record each payment as it arrives, or waive what will never be collected. The case can settle once nothing is outstanding."}
        </p>
        {pending > 0 ? (
          <p className="section-note" data-testid="pending-note">
            {ledgerINR(pending)} has been recorded but not yet confirmed as received. It is not on
            the books and does not count against what a team owes until someone confirms it.
          </p>
        ) : null}
        {viewer.canManage || viewer.canCollect ? (
          <div className="mn-step-actions">
            {/* While money is owed the one useful act is collecting it; Settle
                stays in view, disabled, so the rule is visible. */}
            {!clear && viewer.canCollect ? (
              <Button size="touch" onClick={focusCollect} data-testid="goto-collect">
                <IconPlus size={16} aria-hidden />
                Record a payment
              </Button>
            ) : null}
            {viewer.canManage ? (
              <Button
                variant={clear ? "primary" : "secondary"}
                onClick={() => {
                  setConfirming("settle");
                }}
                disabled={busy || !clear}
                data-testid="settle-case"
                size="touch"
              >
                Settle case
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="section-note">You need a settlement grant to settle this case.</p>
        )}
        <Confirm
          open={confirming === "settle"}
          title="Settle this case?"
          confirmLabel="Settle case"
          testId="confirm-settle"
          busy={busy}
          onClose={() => {
            setConfirming(null);
          }}
          onConfirm={() =>
            act(() => settleCaseAction(slug, caseId), "Case settled.").then((ok) => {
              if (ok) {
                setConfirming(null);
              }
            })
          }
        >
          <p className="section-note">
            Settling locks every team's amount at{" "}
            {ledgerINR(settlementCase.financial.totalObligations)} in dues,{" "}
            {ledgerINR(settlementCase.financial.discharged)} collected and{" "}
            {ledgerINR(settlementCase.financial.waived)} waived. After this, no payment can be
            recorded and nothing can be waived on this case.
          </p>
          <p className="section-note">
            This is reversible: a settlement controller can reopen the case, with a reason on the
            record. Closing, the step after this one, is not.
          </p>
        </Confirm>
      </Next>
    );
  }

  if (settlementCase.status === "settled") {
    const blocked = readiness !== null && !readiness.ready;
    return (
      <Next tone="gold" icon={<IconLock size={18} />} title="Close the case">
        <p className="section-note">
          Closing runs the full financial verification and seals an evidence package that can be
          replayed for ever. Once closed, the auction reads as Reconciled.
        </p>
        {readiness !== null ? <Readiness readiness={readiness} /> : null}
        {viewer.canManage ? (
          <div className="mn-step-actions">
            <Button
              onClick={() => {
                setConfirming("close");
              }}
              disabled={busy || blocked}
              data-testid="close-case"
              size="touch"
            >
              <IconLock size={16} aria-hidden />
              Close case
            </Button>
          </div>
        ) : (
          <p className="section-note">You need a settlement grant to close this case.</p>
        )}
        <Confirm
          open={confirming === "close"}
          title="Close this case and seal the evidence?"
          confirmLabel="Close case"
          testId="confirm-close"
          busy={busy}
          onClose={() => {
            setConfirming(null);
          }}
          onConfirm={() =>
            act(() => closeCaseAction(slug, caseId), "Case closed. Evidence sealed.").then((ok) => {
              if (ok) {
                setConfirming(null);
              }
            })
          }
        >
          <p className="section-note">
            <strong>This seals the evidence for ever.</strong> Closure re-runs every financial
            check, fingerprints the case, the books, every wallet and every payment, and stores
            those fingerprints as the permanent record that this settlement was right. The auction
            then reads as Reconciled.
          </p>
          <p className="section-note">
            A settlement controller can still reopen the case afterwards, but reopening does not
            unseal anything: the sealed package stays on the record and simply stops applying.
            Nothing you do later can change what was sealed here.
          </p>
        </Confirm>
      </Next>
    );
  }

  if (settlementCase.status === "closed") {
    return (
      <Next tone="green" icon={<IconCheck size={18} />} title="Settlement complete">
        <p className="section-note">
          This case is closed and the auction reads as Reconciled. The evidence sealed at closure is
          on the case review, where it can be replayed and checked against the log.
        </p>
        <div className="mn-step-actions">
          <ButtonLink
            href={`/seasons/${slug}/money/case/${caseId}`}
            size="touch"
            variant="secondary"
            data-testid="view-evidence"
          >
            View closure evidence
          </ButtonLink>
        </div>
      </Next>
    );
  }

  return (
    <Next tone="neutral" icon={<IconAlert size={18} />} title="This case was voided">
      <p className="section-note">
        A voided case settles nothing and moves no money. Its history stays on the case review.
      </p>
    </Next>
  );
}

/**
 * The one confirmation shape the lifecycle steps share: say what becomes
 * irreversible, in that order, and make the confirming button say the act.
 */
function Confirm({
  open,
  title,
  confirmLabel,
  testId,
  busy,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  testId: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void onConfirm();
            }}
            data-testid={testId}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

const CHECK_LABEL: Record<string, string> = {
  case_settled: "The case is settled",
  no_outstanding: "No team still owes money",
  trial_balance_zero: "The books balance",
  dues_cleared: "Every team's dues are clear",
  no_refund_liability: "No refund is owed",
  obligations_match_source: "The obligations still match the auction",
  collections_reconcile: "The collections reconcile",
};

function Readiness({
  readiness,
}: {
  readiness: { ready: boolean; status: string; blockers: readonly string[] };
}) {
  if (readiness.ready) {
    return (
      <p className="section-note mn-ready" data-testid="closure-ready">
        <IconCheck size={14} aria-hidden /> Every closure check passes. This case is ready to close.
      </p>
    );
  }
  return (
    <ul className="check-list mn-checks" data-testid="closure-blockers">
      {readiness.blockers.map((blocker) => (
        <li key={blocker}>
          <Pill tone="red">Blocked</Pill>
          <span>{CHECK_LABEL[blocker] ?? blocker}</span>
        </li>
      ))}
    </ul>
  );
}

// --- Reopen / void: rare, audited, in the hero's ⋯ ----------------------------------

function CaseMenu({
  slug,
  settlementCase,
  competitionName,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  competitionName: string;
  busy: boolean;
  act: Act;
}) {
  const [open, setOpen] = useState<"reopen" | "void" | null>(null);
  const [reason, setReason] = useState("");

  const canReopen = settlementCase.status === "settled" || settlementCase.status === "closed";
  const canVoid =
    settlementCase.status === "opened" ||
    settlementCase.status === "verified" ||
    settlementCase.status === "discrepant";

  if (!canReopen && !canVoid) {
    return null;
  }

  return (
    <>
      <PopoverMenu
        label="More case actions"
        trigger={<IconKebab size={20} />}
        triggerClassName="mn-kebab"
        items={[
          ...(canReopen
            ? [
                {
                  key: "reopen",
                  label: "Reopen case…",
                  testId: "open-reopen",
                  onSelect: () => {
                    setOpen("reopen");
                    setReason("");
                  },
                },
              ]
            : []),
          ...(canVoid
            ? [
                {
                  key: "void",
                  label: "Void case…",
                  danger: true,
                  testId: "open-void",
                  onSelect: () => {
                    setOpen("void");
                    setReason("");
                  },
                },
              ]
            : []),
        ]}
      />

      {open !== null ? (
        <Dialog
          open
          onClose={() => {
            setOpen(null);
          }}
          title={open === "void" ? `Void the case for ${competitionName}` : "Reopen the case"}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || reason.trim() === ""}
                onClick={() => {
                  const which = open;
                  void act(
                    () =>
                      which === "void"
                        ? voidCaseAction(slug, settlementCase.caseId, reason)
                        : reopenCaseAction(slug, settlementCase.caseId, reason),
                    which === "void" ? "Case voided." : "Case reopened for collection.",
                  ).then((ok) => {
                    if (ok) {
                      setOpen(null);
                    }
                  });
                }}
                data-testid="confirm-override"
              >
                {open === "void" ? "Void case" : "Reopen case"}
              </Button>
            </>
          }
        >
          <p className="section-note">
            {open === "void"
              ? "Voiding abandons this case. It can only be done before any money has moved, and the auction will have no settlement until a new case is opened."
              : "Reopening takes a settled or closed case back to collecting. If it was closed, it stops reading as Reconciled and its sealed evidence no longer applies."}
          </p>
          <p className="section-note">
            It is recorded against your name with the reason you give, and shows on the case for
            ever.
          </p>
          <Field
            label="Why?"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            required
            data-testid="override-reason"
          />
        </Dialog>
      ) : null}
    </>
  );
}

// --- Teams --------------------------------------------------------------------------

function Teams({
  slug,
  settlementCase,
  teams,
  viewer,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  teams: ReadonlyMap<string, ConsoleTeam>;
  viewer: ConsoleView["viewer"];
  busy: boolean;
  act: Act;
}) {
  const [waiving, setWaiving] = useState<ObligationView | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  // PRR P1-2: one stable key per waive intent, re-minted each time the dialog
  // opens, so a timeout-then-retry dedupes server-side but a genuine second
  // waiver of the same amount is a new intent.
  const [intentKey, setIntentKey] = useState(() => crypto.randomUUID());
  // The payment form's team, lifted here so a card's "Record payment" can pick it.
  const [payTeam, setPayTeam] = useState("");
  const payAmountRef = useRef<HTMLDivElement>(null);

  if (settlementCase.obligations.length === 0) {
    return (
      <SectionCard
        icon={<IconUsers />}
        title="What each team owes"
        description="Nothing has been worked out yet. Once the case is verified and the amounts are worked out, every team's due appears here."
      />
    );
  }

  const settling = settlementCase.status === "settling";
  const canWaive = viewer.canOverride && settling;
  const canCollect = viewer.canCollect && settling;
  const clearCount = settlementCase.obligations.filter((o) => o.outstanding === 0).length;
  const paymentsOf = (teamId: string) =>
    settlementCase.payments.filter((payment) => payment.teamId === teamId).length;

  return (
    <section className="mn-teams" aria-labelledby="mn-teams-title">
      <div className="mn-section-head">
        <h2 id="mn-teams-title">Teams</h2>
        <span>
          {String(clearCount)} of {String(settlementCase.obligations.length)} clear
        </span>
      </div>

      <ul className="mn-team-grid" data-testid="obligations-table">
        {settlementCase.obligations.map((obligation) => {
          const owes = obligation.amount + obligation.increased;
          const clear = obligation.outstanding === 0;
          const payments = paymentsOf(obligation.teamId);
          return (
            <li
              key={obligation.teamId}
              className="mn-team-card"
              data-clear={clear ? "" : undefined}
              data-testid={`obligation-${obligation.teamId}`}
            >
              <div className="mn-team-top">
                <TeamMark
                  team={teams.get(obligation.teamId)}
                  name={obligation.teamName}
                  size={40}
                />
                <div className="mn-team-name">
                  <strong>{obligation.teamName}</strong>
                  <span>
                    owes <Amount value={owes} /> · {String(payments)} payment
                    {payments === 1 ? "" : "s"}
                  </span>
                </div>
                {clear ? (
                  <Pill tone="green" dot>
                    Clear
                  </Pill>
                ) : (
                  <Pill tone="amber">{`${ledgerINR(obligation.outstanding)} to collect`}</Pill>
                )}
              </div>
              {owes > 0 ? (
                <Bar
                  share={(obligation.discharged + obligation.waived) / owes}
                  tone={clear ? "green" : "gold"}
                />
              ) : null}
              <div className="mn-team-foot">
                <span className="mn-team-sums">
                  <strong>
                    <Amount value={obligation.discharged} />
                  </strong>{" "}
                  collected · <Amount value={obligation.waived} /> waived
                  {obligation.pending > 0 ? (
                    <>
                      {" "}
                      · <Amount value={obligation.pending} /> awaiting confirmation
                    </>
                  ) : null}
                </span>
                {canCollect && !clear ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={`Record a payment from ${obligation.teamName}`}
                    onClick={() => {
                      setPayTeam(obligation.teamId);
                      payAmountRef.current?.querySelector("input")?.focus();
                      payAmountRef.current?.scrollIntoView({ block: "center" });
                    }}
                    data-testid={`collect-${obligation.teamId}`}
                  >
                    <IconPlus size={14} aria-hidden />
                    Record payment
                  </Button>
                ) : null}
                {canWaive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || clear}
                    onClick={() => {
                      setWaiving(obligation);
                      setAmount("");
                      setReason("");
                      setIntentKey(crypto.randomUUID());
                    }}
                    data-testid={`waive-${obligation.teamId}`}
                  >
                    Waive
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {canCollect ? (
        <Collect
          slug={slug}
          settlementCase={settlementCase}
          teamId={payTeam}
          setTeamId={setPayTeam}
          amountRef={payAmountRef}
          busy={busy}
          act={act}
        />
      ) : null}

      {waiving !== null ? (
        <Dialog
          open
          onClose={() => {
            setWaiving(null);
          }}
          title={`Waive part of what ${waiving.teamName} owes`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setWaiving(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || amount.trim() === "" || reason.trim() === ""}
                onClick={() => {
                  const target = waiving;
                  void act(
                    () =>
                      waiveObligationAction(
                        slug,
                        settlementCase.caseId,
                        target.teamId,
                        amount,
                        reason,
                        intentKey,
                      ),
                    "Waived. The books were updated.",
                  ).then((ok) => {
                    if (ok) {
                      setWaiving(null);
                    }
                  });
                }}
                data-testid="confirm-waive"
              >
                Waive amount
              </Button>
            </>
          }
        >
          <p className="section-note">
            Waiving forgives money this team owes. It is recorded against your name with the reason
            you give, it posts to the books, and it cannot be undone — only reopened. They still owe{" "}
            {ledgerINR(waiving.outstanding)}.
          </p>
          <Field
            label="Amount to waive (₹)"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            required
            data-testid="waive-amount"
          />
          <Field
            label="Why is this being waived?"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            required
            data-testid="waive-reason"
          />
        </Dialog>
      ) : null}
    </section>
  );
}

// --- Collect ------------------------------------------------------------------------

function Collect({
  slug,
  settlementCase,
  teamId,
  setTeamId,
  amountRef,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  teamId: string;
  setTeamId: (teamId: string) => void;
  amountRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  act: Act;
}) {
  const owing = settlementCase.obligations.filter((obligation) => obligation.outstanding > 0);
  const [method, setMethod] = useState("manual:cash");
  const [amount, setAmount] = useState("");
  /*
   * THE INTENT KEY — one per payment the operator means to record.
   *
   * The server derives both the payment id and the command id from this key, so
   * a double-click, a retried server action or a flaky network replays the SAME
   * intent and the writer dedupes it instead of creating a second payment and a
   * second gateway order. It is regenerated only AFTER a payment lands, which is
   * what makes the next one genuinely new — recording two identical amounts for
   * one team on purpose still works, because that is a fresh key.
   */
  const [intentKey, setIntentKey] = useState(() => crypto.randomUUID());

  if (owing.length === 0) {
    return null;
  }

  return (
    <div className="mn-collect" id="record-payment">
      <div className="mn-collect-head">
        <h3>Record a payment</h3>
        <p className="section-note">
          Record the money as it arrives. It is confirmed once it is actually in hand — confirming
          puts it on the books and takes it off what the team owes.
        </p>
      </div>
      <div className="money-form mn-form">
        <Select
          label="Which team paid?"
          value={teamId}
          onChange={(event) => {
            setTeamId(event.target.value);
          }}
          data-testid="pay-team"
        >
          <option value="">Choose a team</option>
          {owing.map((obligation) => (
            <option key={obligation.teamId} value={obligation.teamId}>
              {obligation.teamName} — owes {ledgerINR(obligation.outstanding)}
            </option>
          ))}
        </Select>
        <Select
          label="How did it arrive?"
          value={method}
          onChange={(event) => {
            setMethod(event.target.value);
          }}
          data-testid="pay-method"
        >
          {METHODS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
        <div className="money-form-amount" ref={amountRef}>
          <Field
            label="Amount (₹)"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            data-testid="pay-amount"
          />
        </div>
        <Button
          onClick={() => {
            void act(
              () =>
                recordPaymentAction(slug, settlementCase.caseId, teamId, method, amount, intentKey),
              "Payment recorded. Attest it once the money is in hand.",
            ).then((ok) => {
              if (ok) {
                setAmount("");
                setTeamId("");
                // Only a payment that actually landed starts a new intent; a
                // failed attempt keeps its key so retrying it stays idempotent.
                setIntentKey(crypto.randomUUID());
              }
            });
          }}
          disabled={busy || teamId === "" || amount.trim() === ""}
          data-testid="record-payment"
          size="touch"
        >
          Record payment
        </Button>
      </div>
    </div>
  );
}

// --- Payments -----------------------------------------------------------------------

function Payments({
  slug,
  settlementCase,
  teams,
  canCollect,
  canOverride,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  teams: ReadonlyMap<string, ConsoleTeam>;
  canCollect: boolean;
  canOverride: boolean;
  busy: boolean;
  act: Act;
}) {
  const [refunding, setRefunding] = useState<PaymentView | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  // PRR P1-2: one stable key per refund intent, re-minted each time the dialog
  // opens — a lost-answer retry dedupes, a deliberate second refund does not.
  const [intentKey, setIntentKey] = useState(() => crypto.randomUUID());

  if (settlementCase.payments.length === 0) {
    return (
      <SectionCard
        icon={<IconLedger />}
        tone="purple"
        title="Payments"
        description="No money has been recorded yet. Every payment appears here with the day it was recorded, how it arrived, and who confirmed it."
      />
    );
  }

  // Newest first: the one just recorded is the one about to be confirmed.
  const payments = [...settlementCase.payments].sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt),
  );

  return (
    <section className="mn-payments" aria-labelledby="mn-payments-title">
      <div className="mn-section-head">
        <h2 id="mn-payments-title">Payments</h2>
        <span>{String(payments.length)} recorded · newest first</span>
      </div>
      <ul className="mn-pay-list" data-testid="payments-table">
        {payments.map((payment) => (
          <PaymentRow
            key={payment.paymentId}
            slug={slug}
            payment={payment}
            team={teams.get(payment.teamId)}
            canCollect={canCollect}
            canOverride={canOverride}
            busy={busy}
            act={act}
            onRefund={() => {
              setRefunding(payment);
              setAmount("");
              setReason("");
              setIntentKey(crypto.randomUUID());
            }}
          />
        ))}
      </ul>

      {/*
       * The refund path. `refundPaymentAction` has been exported on the server
       * since PX-7 and was called from nowhere: once every team was CLEAR the
       * screen offered no money action at all — Collect returns null at zero
       * outstanding, Waive disables, and Overrides renders nothing while the
       * case is still collecting. Money that went in wrong could not be said.
       */}
      {refunding !== null ? (
        <Dialog
          open
          onClose={() => {
            setRefunding(null);
          }}
          title={`Refund part of what ${refunding.teamName} paid`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setRefunding(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || amount.trim() === "" || reason.trim() === ""}
                onClick={() => {
                  const target = refunding;
                  void act(
                    () => refundPaymentAction(slug, target.paymentId, amount, reason, intentKey),
                    "Refunded. The money was put back on what the team owes.",
                  ).then((ok) => {
                    if (ok) {
                      setRefunding(null);
                    }
                  });
                }}
                data-testid="confirm-refund"
              >
                Refund amount
              </Button>
            </>
          }
        >
          <p className="section-note">
            Refunding gives money back that this case already collected. It posts to the books, it
            puts the amount back on what the team owes, and it is recorded against your name with
            the reason you give. This payment collected {ledgerINR(refunding.captured)}
            {refunding.refundedTotal > 0
              ? `, of which ${ledgerINR(refunding.refundedTotal)} is already refunded`
              : ""}
            .
          </p>
          <Field
            label="Amount to refund (₹)"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            required
            data-testid="refund-amount"
          />
          <Field
            label="Why is this being refunded?"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            required
            data-testid="refund-reason"
          />
        </Dialog>
      ) : null}
    </section>
  );
}

function PaymentRow({
  slug,
  payment,
  team,
  canCollect,
  canOverride,
  busy,
  act,
  onRefund,
}: {
  slug: string;
  payment: PaymentView;
  team: ConsoleTeam | undefined;
  canCollect: boolean;
  canOverride: boolean;
  busy: boolean;
  act: Act;
  onRefund: () => void;
}) {
  const methodLabel =
    METHODS.find((entry) => entry.value === payment.method)?.label ?? payment.method;
  // `failed` is terminal by design — a retry is a NEW payment, never a resurrection.
  const retryable = payment.status === "failed";
  const refundable = canOverride && payment.captured - payment.refundedTotal > 0;
  return (
    <li className="mn-pay" data-testid={`payment-${payment.paymentId}`}>
      <TeamMark team={team} name={payment.teamName} size={30} />
      <div className="mn-pay-body">
        <strong>
          {payment.teamName} · {methodLabel}
        </strong>
        {/* The money surfaces carried no date at all: the only timestamps in the
            product were on the Timeline tab, a page away. */}
        <span className="mn-pay-meta">
          <span className="money-when">{formatDateTime(payment.recordedAt)}</span>
          <Pill tone={PAYMENT_TONE[payment.status] ?? "neutral"}>
            {PAYMENT_STATE[payment.status] ?? payment.status}
          </Pill>
          {/* The action promises the money is "recorded against your name". The
              name was fetched and thrown away; here it is. */}
          {payment.attested ? (
            <span data-testid={`attested-by-${payment.paymentId}`}>
              confirmed by {payment.attestedByName ?? "a settlement controller"}
            </span>
          ) : null}
        </span>
        {retryable ? (
          <span className="mn-pay-meta" data-testid={`retry-${payment.paymentId}`}>
            Failed — record a new payment to try again.
          </span>
        ) : null}
      </div>
      <div className="mn-pay-amount">
        <Amount value={payment.amount} />
        {payment.captured !== payment.amount && payment.captured > 0 ? (
          <span>
            <Amount value={payment.captured} /> collected
          </span>
        ) : null}
        {payment.refundedTotal > 0 ? (
          <span>less {ledgerINR(payment.refundedTotal)} refunded</span>
        ) : null}
      </div>
      <div className="mn-pay-actions">
        {canCollect && payment.status === "created" ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              void act(
                () => attestCaptureAction(slug, payment.paymentId),
                "Money confirmed as received. The books were updated.",
              );
            }}
            data-testid={`attest-${payment.paymentId}`}
          >
            Confirm received
          </Button>
        ) : null}
        {refundable ? (
          <PopoverMenu
            label={`More for ${payment.teamName}'s payment`}
            trigger={<IconKebab size={18} />}
            triggerClassName="mn-kebab"
            items={[
              {
                key: "refund",
                label: "Refund…",
                danger: true,
                testId: `refund-${payment.paymentId}`,
                onSelect: onRefund,
              },
            ]}
          />
        ) : null}
      </div>
    </li>
  );
}
