"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  Select,
  useAnnouncer,
  useToast,
  VisuallyHidden,
  type BadgeTone,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
  type ConsoleView,
} from "../../../../server/settlement/actions";
import type { CaseView, ObligationView, PaymentView } from "../../../../server/settlement/views";
import { formatDateTime } from "../../../../lib/format-date";
import { CASE_STATE, PAYMENT_STATE } from "./money-words";
import "./money.css";

/**
 * PX-7 E1 — the Settlement console.
 *
 * The post-gavel workflow, one legal step at a time. Every button here maps to
 * exactly one certified writer command; nothing on this screen decides whether
 * a step is allowed — the case's own status does, and the writer re-decides it
 * server-side regardless of what this component renders. A disabled button is a
 * courtesy, never a control.
 */

const STATUS_TONE = {
  opened: "info",
  verified: "info",
  discrepant: "danger",
  settling: "warning",
  settled: "success",
  closed: "success",
  voided: "neutral",
} as const;

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
const PAYMENT_TONE: Record<string, BadgeTone> = {
  created: "info",
  authorized: "info",
  captured: "success",
  refunded: "neutral",
  failed: "danger",
  disputed: "warning",
};

function inr(value: number): string {
  return formatPaiseINR(paise(value));
}

/** Money always renders with its exact value inspectable (C-7). */
function Amount({ value, label }: { value: number; label?: string }) {
  return (
    <span
      title={`${String(value)} paise`}
      aria-label={label === undefined ? undefined : `${label}: ${inr(value)}`}
    >
      {inr(value)}
    </span>
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
   */
  const finished = status === "closed";
  return (
    <ol className="case-stepper" data-testid="case-stepper" aria-label="Settlement progress">
      {STEPS.map((step, index) => {
        const state = finished || index < at ? "done" : index === at ? "current" : "blocked";
        return (
          <li
            key={step.key}
            className="case-step"
            data-state={state}
            data-step={step.key}
            {...(state === "current" ? { "aria-current": "step" as const } : {})}
          >
            <span className="case-step-mark" aria-hidden>
              {state === "done" ? "✓" : String(index + 1)}
            </span>
            {step.label}
            {state === "done" ? <VisuallyHidden> (done)</VisuallyHidden> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function MoneyPanel({ slug, console: view }: { slug: string; console: ConsoleView }) {
  const router = useRouter();
  const toast = useToast();
  const announce = useAnnouncer();
  const [busy, setBusy] = useState(false);
  // Carries a sequence so two identical outcomes still move focus twice.
  const [outcome, setOutcome] = useState<{ text: string; seq: number } | null>(null);
  const announceOutcome = (text: string) => {
    setOutcome((current) => ({ text, seq: (current?.seq ?? 0) + 1 }));
  };
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);
  // A click before hydration is a no-op; the surface says when it is live.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

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
  const act = async (run: () => Promise<ActionResult>, done: string): Promise<boolean> => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (result.ok) {
      toast({ title: done, tone: "success" });
      announceOutcome(done);
      router.refresh();
      return true;
    }
    toast({ title: result.error, tone: "danger" });
    announce(result.error, "assertive");
    announceOutcome(result.error);
    return false;
  };

  /*
   * Focus has to be re-asserted, not set once.
   *
   * Two things take it away after a money command. A native <dialog>'s
   * `close()` restores focus to whatever was focused when it opened — for
   * Settle and Close that is a button the refreshed tree has just unmounted,
   * so focus falls to <body>. And `router.refresh()` lands a new server tree a
   * few hundred milliseconds later, which can drop it again. So the claim is
   * re-made across that window, and ONLY while focus is sitting on <body> —
   * nothing is ever taken from a real target the reader has moved to.
   */
  useEffect(() => {
    if (outcome === null) {
      return;
    }
    const timers = [0, 60, 200, 600, 1200].map((delay) =>
      setTimeout(() => {
        const node = outcomeRef.current;
        if (node !== null && document.activeElement === document.body) {
          node.focus();
        }
      }, delay),
    );
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [outcome]);

  const outcomeNote =
    outcome === null ? null : (
      <p className="money-result" tabIndex={-1} ref={outcomeRef} data-testid="money-result">
        {outcome.text}
      </p>
    );

  const { competition, auction, case: settlementCase, teams, readiness, viewer } = view;

  if (auction === null) {
    return (
      <Card data-testid="money-panel" data-hydrated={hydrated ? "true" : "false"}>
        <EmptyState
          headingLevel={2}
          title="Settlement opens after the auction"
          description="There is no auction for this season yet. Once the auction is created, conducted and completed, its settlement case opens here."
          action={<ButtonLink href={`/seasons/${slug}/auction`}>Go to the auction</ButtonLink>}
        />
      </Card>
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

  return (
    <div data-testid="money-panel" data-hydrated={hydrated ? "true" : "false"}>
      <Card>
        <div className="competition-title-row">
          <div>
            <CaseStepper status={settlementCase.status} />
          </div>
          <Badge tone={STATUS_TONE[settlementCase.status]} data-testid="case-status">
            {CASE_STATE[settlementCase.status] ?? settlementCase.status}
          </Badge>
        </div>
        {/* The case's identity: number, date, what it stands on, where it is.
            The header band above carried none of it — 110px of empty rule. */}
        <dl className="case-identity" data-testid="case-identity">
          <dt>Case</dt>
          <dd className="digest">{settlementCase.caseId.slice(-8)}</dd>
          <dt>Opened</dt>
          <dd>{formatDateTime(settlementCase.openedAt)}</dd>
          <dt>Dues</dt>
          <dd>
            {settlementCase.basis === "committed"
              ? "from what teams committed in the auction"
              : settlementCase.basis === "fixed"
                ? "from fixed amounts set when the case opened"
                : "as nothing owed"}
          </dd>
        </dl>
        <CaseMoney settlementCase={settlementCase} />
        <p className="section-note">
          <a
            className="money-inline-link"
            href={`/seasons/${slug}/money/case/${settlementCase.caseId}`}
          >
            Open case review
          </a>{" "}
          — every event, every posting, and the evidence closure sealed.
        </p>
      </Card>

      {outcomeNote}

      <NextStep
        slug={slug}
        settlementCase={settlementCase}
        readiness={readiness}
        viewer={viewer}
        busy={busy}
        act={act}
      />

      {settlementCase.status === "settling" ? (
        <>
          <Obligations
            slug={slug}
            settlementCase={settlementCase}
            viewer={viewer}
            busy={busy}
            act={act}
          />
          <Collect
            slug={slug}
            settlementCase={settlementCase}
            canCollect={viewer.canCollect}
            busy={busy}
            act={act}
          />
        </>
      ) : (
        <Obligations
          slug={slug}
          settlementCase={settlementCase}
          viewer={viewer}
          busy={busy}
          act={act}
        />
      )}

      {/* Always rendered once there is a case: "no payments yet" is a fact worth
          stating, and its absence made a case with no money look unfinished. */}
      <Payments
        slug={slug}
        settlementCase={settlementCase}
        canCollect={viewer.canCollect}
        canOverride={viewer.canOverride}
        busy={busy}
        act={act}
      />

      {viewer.canOverride ? (
        <Overrides
          slug={slug}
          settlementCase={settlementCase}
          competitionName={competition.name}
          busy={busy}
          act={act}
        />
      ) : null}
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
      <Card>
        <EmptyState
          headingLevel={2}
          title="The auction has not finished"
          description="A settlement case can only open on a completed auction — that is what freezes the log the money is worked out from. Close the auction first."
          action={<ButtonLink href={`/seasons/${slug}/auction`}>Go to the auction</ButtonLink>}
        />
      </Card>
    );
  }

  if (!canManage) {
    return (
      <Card>
        <EmptyState
          headingLevel={2}
          title="No settlement case yet"
          description="The auction is finished and ready to settle, but you do not have permission to open the case. Ask an organization owner for a settlement grant."
        />
      </Card>
    );
  }

  return (
    <Card>
      <h2>Open the settlement case</h2>
      <p className="section-note">
        Opening the case pins the auction log exactly as it stands now. Everything owed is worked
        out from that pin, and it never moves again.
      </p>
      <div className="money-form">
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
        <fieldset className="fixed-dues">
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
    </Card>
  );
}

// --- Money summary ------------------------------------------------------------------

function CaseMoney({ settlementCase }: { settlementCase: CaseView }) {
  const { financial } = settlementCase;
  const tiles: { label: string; value: number; testId: string }[] = [
    { label: "Total dues", value: financial.totalObligations, testId: "total-obligations" },
    { label: "Collected", value: financial.discharged, testId: "discharged" },
    { label: "Waived", value: financial.waived, testId: "waived" },
    { label: "Outstanding", value: financial.outstanding, testId: "outstanding" },
    // Recorded but not yet attested. Without it, writing ₹10,000.50 against a
    // ₹25,000 due changed no tile and no row — the money was simply invisible.
    ...(settlementCase.pending > 0
      ? [{ label: "Awaiting confirmation", value: settlementCase.pending, testId: "pending" }]
      : []),
  ];
  return (
    <div className="stat-row">
      {tiles.map((tile) => (
        <div className="stat-tile" key={tile.label}>
          <span className="stat-value" data-testid={tile.testId}>
            <Amount value={tile.value} />
          </span>
          <span className="stat-label">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

// --- The one legal next step --------------------------------------------------------

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
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
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
      <Step
        title="Verify the case against the auction"
        body="Verification re-reads the frozen auction log and checks it still matches the pin taken when the case opened. Nothing moves until it does."
        action={
          viewer.canManage ? (
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
          ) : null
        }
        denied={viewer.canManage ? null : "You need a settlement grant to verify this case."}
      />
    );
  }

  if (settlementCase.status === "discrepant") {
    return (
      <Card>
        <h2>The auction log no longer matches</h2>
        <p className="section-note">
          What the auction log says today is not what this case pinned when it opened. Money is
          frozen: nothing can be collected, waived or closed while the case is discrepant. Verifying
          again adopts the log as it stands now — that is an override and is recorded against your
          name.
        </p>
        {viewer.canOverride ? (
          <div className="money-form">
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
      </Card>
    );
  }

  if (settlementCase.status === "verified") {
    return (
      <Step
        title="Work out what each team owes"
        body="This turns the verified auction into a due for every team. It is the last step before money can be collected."
        action={
          viewer.canManage ? (
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
          ) : null
        }
        denied={viewer.canManage ? null : "You need a settlement grant to compute obligations."}
      />
    );
  }

  if (settlementCase.status === "settling") {
    const clear = settlementCase.financial.outstanding === 0;
    const pending = settlementCase.pending;
    return (
      <Card>
        {/*
         * The headline used to read "Everything is accounted for" directly
         * under a COLLECTING badge — a contradiction in one glance. The case IS
         * still collecting; what has changed is that nothing is outstanding.
         */}
        <h2>{clear ? "Nothing is outstanding — ready to settle" : "Collect what is still owed"}</h2>
        <p className="section-note">
          {clear
            ? "No team owes anything. Settling locks the amounts so they can no longer change."
            : "Record each payment as it arrives, or waive what will never be collected. The case can settle once nothing is outstanding."}
        </p>
        {pending > 0 ? (
          <p className="section-note" data-testid="pending-note">
            {inr(pending)} has been recorded but not yet confirmed as received. It is not on the
            books and does not count against what a team owes until someone confirms it.
          </p>
        ) : null}
        {/* Why there are two finishing steps at all. */}
        <p className="section-note">
          Settling and closing are two different acts: settling locks the amounts, and closing — the
          step after it — runs the financial verification and seals the evidence. A settled case can
          still be reopened; a closed one has a sealed record saying it was right.
        </p>
        {viewer.canManage ? (
          <Button
            onClick={() => {
              setConfirming("settle");
            }}
            disabled={busy || !clear}
            data-testid="settle-case"
            size="touch"
          >
            Settle case
          </Button>
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
            Settling locks every team's amount at {inr(settlementCase.financial.totalObligations)}{" "}
            in dues, {inr(settlementCase.financial.discharged)} collected and{" "}
            {inr(settlementCase.financial.waived)} waived. After this, no payment can be recorded
            and nothing can be waived on this case.
          </p>
          <p className="section-note">
            This is reversible: a settlement controller can reopen the case, with a reason on the
            record. Closing, the step after this one, is not.
          </p>
        </Confirm>
      </Card>
    );
  }

  if (settlementCase.status === "settled") {
    const blocked = readiness !== null && !readiness.ready;
    return (
      <Card>
        <h2>Close the case</h2>
        <p className="section-note">
          Closing runs the full financial verification and seals an evidence package that can be
          replayed for ever. Once closed, the auction reads as Reconciled.
        </p>
        {readiness !== null ? <Readiness readiness={readiness} /> : null}
        {viewer.canManage ? (
          <Button
            onClick={() => {
              setConfirming("close");
            }}
            disabled={busy || blocked}
            data-testid="close-case"
            size="touch"
          >
            Close case
          </Button>
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
      </Card>
    );
  }

  if (settlementCase.status === "closed") {
    return (
      <Card>
        <h2>Settlement complete</h2>
        <p className="section-note">
          This case is closed and the auction reads as Reconciled. The evidence sealed at closure is
          on the case review, where it can be replayed and checked against the log.
        </p>
        <div className="money-row-actions" style={{ justifyContent: "flex-start" }}>
          <ButtonLink
            href={`/seasons/${slug}/money/case/${caseId}`}
            size="touch"
            data-testid="view-evidence"
          >
            View closure evidence
          </ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2>This case was voided</h2>
      <p className="section-note">
        A voided case settles nothing and moves no money. Its history stays on the case review.
      </p>
    </Card>
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

function Step({
  title,
  body,
  action,
  denied,
}: {
  title: string;
  body: string;
  action: ReactNode;
  denied: string | null;
}) {
  return (
    <Card>
      <h2>{title}</h2>
      <p className="section-note">{body}</p>
      {action}
      {denied !== null ? <p className="section-note">{denied}</p> : null}
    </Card>
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
      <p className="section-note" data-testid="closure-ready">
        Every closure check passes. This case is ready to close.
      </p>
    );
  }
  return (
    <ul className="check-list" data-testid="closure-blockers">
      {readiness.blockers.map((blocker) => (
        <li key={blocker}>
          <Badge tone="danger">Blocked</Badge>
          <span>{CHECK_LABEL[blocker] ?? blocker}</span>
        </li>
      ))}
    </ul>
  );
}

// --- Obligations --------------------------------------------------------------------

function Obligations({
  slug,
  settlementCase,
  viewer,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  viewer: ConsoleView["viewer"];
  busy: boolean;
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
}) {
  const [waiving, setWaiving] = useState<ObligationView | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  // PRR P1-2: one stable key per waive intent, re-minted each time the dialog
  // opens, so a timeout-then-retry dedupes server-side but a genuine second
  // waiver of the same amount is a new intent.
  const [intentKey, setIntentKey] = useState(() => crypto.randomUUID());

  if (settlementCase.obligations.length === 0) {
    return (
      <Card>
        {/* The card's own body already said "what each team owes"; the heading
            said "Obligations". The prose was the better of the two. */}
        <h2>What each team owes</h2>
        <EmptyState
          headingLevel={3}
          title="Nothing has been worked out yet"
          description="Once the case is verified and the amounts are worked out, every team's due appears here."
        />
      </Card>
    );
  }

  const canWaive = viewer.canOverride && settlementCase.status === "settling";
  const anyPending = settlementCase.obligations.some((obligation) => obligation.pending > 0);

  return (
    <Card>
      <h2>What each team owes</h2>
      <div
        className="table-scroll money-scroll"
        tabIndex={0}
        role="region"
        aria-label="What each team owes"
      >
        <table className="money-table" data-testid="obligations-table">
          <caption>
            <VisuallyHidden>What each team owes, has paid, and still owes</VisuallyHidden>
          </caption>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col" className="num">
                Owes
              </th>
              <th scope="col" className="num">
                Collected
              </th>
              <th scope="col" className="num">
                Waived
              </th>
              {anyPending ? (
                <th scope="col" className="num">
                  Awaiting confirmation
                </th>
              ) : null}
              <th scope="col" className="num">
                Outstanding
              </th>
              {canWaive ? (
                <th scope="col" className="num">
                  <VisuallyHidden>Actions</VisuallyHidden>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {settlementCase.obligations.map((obligation) => (
              <tr
                key={obligation.teamId}
                data-testid={`obligation-${obligation.teamId}`}
                className={obligation.outstanding === 0 ? "settled-row" : undefined}
              >
                {/* The team is the ROW HEADER — the word that makes every
                    figure beside it mean something to a screen reader. */}
                <th scope="row" data-label="Team">
                  {obligation.teamName}
                </th>
                <td data-label="Owes" className="num">
                  <Amount value={obligation.amount + obligation.increased} />
                </td>
                <td data-label="Collected" className="num">
                  <Amount value={obligation.discharged} />
                </td>
                <td data-label="Waived" className="num">
                  <Amount value={obligation.waived} />
                </td>
                {anyPending ? (
                  <td data-label="Awaiting confirmation" className="num">
                    <Amount value={obligation.pending} />
                  </td>
                ) : null}
                <td
                  data-label="Outstanding"
                  className="num"
                  data-outstanding={obligation.outstanding}
                >
                  {obligation.outstanding === 0 ? (
                    <Badge tone="success">Clear</Badge>
                  ) : (
                    <Amount value={obligation.outstanding} />
                  )}
                </td>
                {canWaive ? (
                  <td data-label="" className="num">
                    <div className="money-row-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || obligation.outstanding === 0}
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
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" data-label="">
                Total
              </th>
              <td data-label="Owes" className="num">
                <Amount value={settlementCase.financial.totalObligations} />
              </td>
              <td data-label="Collected" className="num">
                <Amount value={settlementCase.financial.discharged} />
              </td>
              <td data-label="Waived" className="num">
                <Amount value={settlementCase.financial.waived} />
              </td>
              {anyPending ? (
                <td data-label="Awaiting confirmation" className="num">
                  <Amount value={settlementCase.pending} />
                </td>
              ) : null}
              <td data-label="Outstanding" className="num">
                <Amount value={settlementCase.financial.outstanding} />
              </td>
              {canWaive ? <td data-label="" /> : null}
            </tr>
          </tfoot>
        </table>
      </div>

      <Dialog
        open={waiving !== null}
        onClose={() => {
          setWaiving(null);
        }}
        title={waiving === null ? "Waive" : `Waive part of what ${waiving.teamName} owes`}
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
                if (target === null) {
                  return;
                }
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
          you give, it posts to the books, and it cannot be undone — only reopened.
          {waiving !== null ? ` They still owe ${inr(waiving.outstanding)}.` : ""}
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
    </Card>
  );
}

// --- Collect ------------------------------------------------------------------------

function Collect({
  slug,
  settlementCase,
  canCollect,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  canCollect: boolean;
  busy: boolean;
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
}) {
  const owing = settlementCase.obligations.filter((obligation) => obligation.outstanding > 0);
  const [teamId, setTeamId] = useState("");
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

  if (!canCollect) {
    return null;
  }
  if (owing.length === 0) {
    return null;
  }

  return (
    <Card>
      <h2>Record a payment</h2>
      <p className="section-note">
        Record the money as it arrives. A payment is written down first and confirmed once it is
        actually in hand — confirming is what puts it on the books and takes it off what the team
        owes. Until then it shows as awaiting confirmation.
      </p>
      <div className="money-form">
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
              {obligation.teamName} — owes {inr(obligation.outstanding)}
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
        <div className="money-form-amount">
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
    </Card>
  );
}

// --- Payments -----------------------------------------------------------------------

function Payments({
  slug,
  settlementCase,
  canCollect,
  canOverride,
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  canCollect: boolean;
  canOverride: boolean;
  busy: boolean;
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
}) {
  const [refunding, setRefunding] = useState<PaymentView | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  // PRR P1-2: one stable key per refund intent, re-minted each time the dialog
  // opens — a lost-answer retry dedupes, a deliberate second refund does not.
  const [intentKey, setIntentKey] = useState(() => crypto.randomUUID());

  if (settlementCase.payments.length === 0) {
    return (
      <Card>
        <h2>Payments</h2>
        <EmptyState
          headingLevel={3}
          title="No money has been recorded yet"
          description="Every payment recorded against this case appears here with the day it was recorded, how it arrived, and who confirmed it."
        />
      </Card>
    );
  }

  return (
    <Card>
      <h2>Payments</h2>
      <div
        className="table-scroll money-scroll"
        tabIndex={0}
        role="region"
        aria-label="Payments recorded against this case"
      >
        <table className="money-table" data-testid="payments-table">
          <caption>
            <VisuallyHidden>Every payment recorded against this case</VisuallyHidden>
          </caption>
          <thead>
            <tr>
              <th scope="col">Team</th>
              {/* The money surfaces carried no date at all: the only timestamps
                  in the product were on the Timeline tab, a page away. */}
              <th scope="col">Recorded</th>
              <th scope="col">Method</th>
              <th scope="col">State</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" className="num">
                Collected
              </th>
              <th scope="col" className="num">
                <VisuallyHidden>Actions</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {settlementCase.payments.map((payment) => (
              <PaymentRow
                key={payment.paymentId}
                slug={slug}
                payment={payment}
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
          </tbody>
        </table>
      </div>

      {/*
       * The refund path. `refundPaymentAction` has been exported on the server
       * since PX-7 and was called from nowhere: once every team was CLEAR the
       * screen offered no money action at all — Collect returns null at zero
       * outstanding, Waive disables, and Overrides renders nothing while the
       * case is still collecting. Money that went in wrong could not be said.
       */}
      <Dialog
        open={refunding !== null}
        onClose={() => {
          setRefunding(null);
        }}
        title={refunding === null ? "Refund" : `Refund part of what ${refunding.teamName} paid`}
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
                if (target === null) {
                  return;
                }
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
          puts the amount back on what the team owes, and it is recorded against your name with the
          reason you give.
          {refunding !== null
            ? ` This payment collected ${inr(refunding.captured)}${
                refunding.refundedTotal > 0
                  ? `, of which ${inr(refunding.refundedTotal)} is already refunded`
                  : ""
              }.`
            : ""}
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
    </Card>
  );
}

function PaymentRow({
  slug,
  payment,
  canCollect,
  canOverride,
  busy,
  act,
  onRefund,
}: {
  slug: string;
  payment: PaymentView;
  canCollect: boolean;
  canOverride: boolean;
  busy: boolean;
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
  onRefund: () => void;
}) {
  const methodLabel =
    METHODS.find((entry) => entry.value === payment.method)?.label ?? payment.method;
  // `failed` is terminal by design — a retry is a NEW payment, never a resurrection.
  const retryable = payment.status === "failed";
  const refundable = canOverride && payment.captured - payment.refundedTotal > 0;
  return (
    <tr data-testid={`payment-${payment.paymentId}`}>
      <th scope="row" data-label="Team">
        {payment.teamName}
      </th>
      <td data-label="Recorded" className="money-when">
        {formatDateTime(payment.recordedAt)}
      </td>
      <td data-label="Method">{methodLabel}</td>
      <td data-label="State">
        <Badge tone={PAYMENT_TONE[payment.status] ?? "neutral"}>
          {PAYMENT_STATE[payment.status] ?? payment.status}
        </Badge>
        {/* The action promises the money is "recorded against your name". The
            name was fetched and thrown away; here it is. */}
        {payment.attested ? (
          <span className="section-note" data-testid={`attested-by-${payment.paymentId}`}>
            {" "}
            confirmed by {payment.attestedByName ?? "a settlement controller"}
          </span>
        ) : null}
      </td>
      <td data-label="Amount" className="num">
        <Amount value={payment.amount} />
      </td>
      <td data-label="Collected" className="num">
        <Amount value={payment.captured} />
        {payment.refundedTotal > 0 ? (
          <span className="section-note"> less {inr(payment.refundedTotal)} refunded</span>
        ) : null}
      </td>
      <td data-label="" className="num">
        <div className="money-row-actions">
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
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={onRefund}
              data-testid={`refund-${payment.paymentId}`}
            >
              Refund
            </Button>
          ) : null}
          {retryable ? (
            <span className="section-note" data-testid={`retry-${payment.paymentId}`}>
              Failed — record a new payment to try again.
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

// --- Overrides ----------------------------------------------------------------------

function Overrides({
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
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
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
    <Card>
      <div className="override-well">
        <h3>Controller actions</h3>
        <p className="override-hint">
          These undo settled money. Every one is recorded against your name with the reason you
          give, and shows on the case for ever.
        </p>
        <div className="money-row-actions" style={{ justifyContent: "flex-start" }}>
          {canReopen ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setOpen("reopen");
                setReason("");
              }}
              data-testid="open-reopen"
            >
              Reopen case
            </Button>
          ) : null}
          {canVoid ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setOpen("void");
                setReason("");
              }}
              data-testid="open-void"
            >
              Void case
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog
        open={open !== null}
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
                if (which === null) {
                  return;
                }
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
    </Card>
  );
}
