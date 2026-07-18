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
  useToast,
  VisuallyHidden,
  type BadgeTone,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  attestCaptureAction,
  closeCaseAction,
  computeObligationsAction,
  openCaseAction,
  recordPaymentAction,
  reopenCaseAction,
  settleCaseAction,
  verifyCaseAction,
  voidCaseAction,
  waiveObligationAction,
  type ActionResult,
  type ConsoleView,
} from "../../../../server/settlement/actions";
import type { CaseView, ObligationView, PaymentView } from "../../../../server/settlement/views";
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

const STATUS_LABEL: Record<string, string> = {
  opened: "Opened",
  verified: "Verified",
  discrepant: "Discrepant",
  settling: "Collecting",
  settled: "Settled",
  closed: "Reconciled",
  voided: "Voided",
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
  return (
    <ol className="case-stepper" data-testid="case-stepper" aria-label="Settlement progress">
      {STEPS.map((step, index) => {
        const state = index < at ? "done" : index === at ? "current" : "blocked";
        return (
          <li
            key={step.key}
            className="case-step"
            data-state={state}
            data-step={step.key}
            {...(state === "current" ? { "aria-current": "step" as const } : {})}
          >
            <span className="case-step-mark" aria-hidden>
              {index < at ? "✓" : String(index + 1)}
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
  const [busy, setBusy] = useState(false);
  // A click before hydration is a no-op; the surface says when it is live.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  /** One command runner: every action reports, then re-reads the server truth. */
  const act = async (run: () => Promise<ActionResult>, done: string): Promise<boolean> => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (result.ok) {
      toast({ title: done, tone: "success" });
      router.refresh();
      return true;
    }
    toast({ title: result.error, tone: "danger" });
    return false;
  };

  const { competition, auction, case: settlementCase, teams, readiness, viewer } = view;

  if (auction === null) {
    return (
      <Card data-testid="money-panel" data-hydrated={hydrated ? "true" : "false"}>
        <EmptyState
          headingLevel={2}
          title="Settlement opens after the auction"
          description="There is no auction for this competition yet. Once the auction is created, conducted and completed, its settlement case opens here."
          action={<ButtonLink href={`/competitions/${slug}/auction`}>Go to the auction</ButtonLink>}
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
            {STATUS_LABEL[settlementCase.status] ?? settlementCase.status}
          </Badge>
        </div>
        <CaseMoney settlementCase={settlementCase} />
        <p className="section-note">
          Case {settlementCase.caseId.slice(-8)} · dues worked out{" "}
          {settlementCase.basis === "committed"
            ? "from what teams committed in the auction"
            : settlementCase.basis === "fixed"
              ? "from fixed amounts set when the case opened"
              : "as nothing owed"}
          .{" "}
          <a href={`/competitions/${slug}/money/case/${settlementCase.caseId}`}>Open case review</a>
        </p>
      </Card>

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

      {settlementCase.payments.length > 0 ? (
        <Payments
          slug={slug}
          settlementCase={settlementCase}
          canCollect={viewer.canCollect}
          busy={busy}
          act={act}
        />
      ) : null}

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
          action={<ButtonLink href={`/competitions/${slug}/auction`}>Go to the auction</ButtonLink>}
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
          data-testid="open-case"
        >
          Open case
        </Button>
      </div>
      {basis === "fixed" ? (
        <fieldset className="fixed-dues">
          <legend>What each team owes</legend>
          {teams.length === 0 ? (
            <p className="section-note">This competition has no teams to charge.</p>
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
    return (
      <Step
        title={clear ? "Everything is accounted for" : "Collect what is still owed"}
        body={
          clear
            ? "No team owes anything. Settling the case locks the obligations and readies it for closure."
            : "Record each payment as it arrives, or waive what will never be collected. The case can settle once nothing is outstanding."
        }
        action={
          viewer.canManage ? (
            <Button
              onClick={() => {
                void act(() => settleCaseAction(slug, caseId), "Case settled.");
              }}
              disabled={busy || !clear}
              data-testid="settle-case"
            >
              Settle case
            </Button>
          ) : null
        }
        denied={viewer.canManage ? null : "You need a settlement grant to settle this case."}
      />
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
              void act(() => closeCaseAction(slug, caseId), "Case closed. Evidence sealed.");
            }}
            disabled={busy || blocked}
            data-testid="close-case"
          >
            Close case
          </Button>
        ) : (
          <p className="section-note">You need a settlement grant to close this case.</p>
        )}
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
            href={`/competitions/${slug}/money/case/${caseId}`}
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

  if (settlementCase.obligations.length === 0) {
    return (
      <Card>
        <h2>Obligations</h2>
        <EmptyState
          headingLevel={3}
          title="Nothing has been worked out yet"
          description="Once the case is verified and the obligations are computed, every team's due appears here."
        />
      </Card>
    );
  }

  const canWaive = viewer.canOverride && settlementCase.status === "settling";

  return (
    <Card>
      <h2>Obligations</h2>
      <div className="table-scroll">
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
                <td data-label="Team">{obligation.teamName}</td>
                <td data-label="Owes" className="num">
                  <Amount value={obligation.amount + obligation.increased} />
                </td>
                <td data-label="Collected" className="num">
                  <Amount value={obligation.discharged} />
                </td>
                <td data-label="Waived" className="num">
                  <Amount value={obligation.waived} />
                </td>
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
              <td data-label="">Total</td>
              <td data-label="Owes" className="num">
                <Amount value={settlementCase.financial.totalObligations} />
              </td>
              <td data-label="Collected" className="num">
                <Amount value={settlementCase.financial.discharged} />
              </td>
              <td data-label="Waived" className="num">
                <Amount value={settlementCase.financial.waived} />
              </td>
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
        Record the money as it arrives. A payment is recorded first, then attested when you have
        actually received it — attesting is what moves it onto the books.
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
              () => recordPaymentAction(slug, settlementCase.caseId, teamId, method, amount),
              "Payment recorded. Attest it once the money is in hand.",
            ).then((ok) => {
              if (ok) {
                setAmount("");
                setTeamId("");
              }
            });
          }}
          disabled={busy || teamId === "" || amount.trim() === ""}
          data-testid="record-payment"
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
  busy,
  act,
}: {
  slug: string;
  settlementCase: CaseView;
  canCollect: boolean;
  busy: boolean;
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
}) {
  return (
    <Card>
      <h2>Payments</h2>
      <div className="table-scroll">
        <table className="money-table" data-testid="payments-table">
          <caption>
            <VisuallyHidden>Every payment recorded against this case</VisuallyHidden>
          </caption>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Method</th>
              <th scope="col">Status</th>
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
                busy={busy}
                act={act}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PaymentRow({
  slug,
  payment,
  canCollect,
  busy,
  act,
}: {
  slug: string;
  payment: PaymentView;
  canCollect: boolean;
  busy: boolean;
  act: (run: () => Promise<ActionResult>, done: string) => Promise<boolean>;
}) {
  const methodLabel =
    METHODS.find((entry) => entry.value === payment.method)?.label ?? payment.method;
  // `failed` is terminal by design — a retry is a NEW payment, never a resurrection.
  const retryable = payment.status === "failed";
  return (
    <tr data-testid={`payment-${payment.paymentId}`}>
      <td data-label="Team">{payment.teamName}</td>
      <td data-label="Method">{methodLabel}</td>
      <td data-label="Status">
        <Badge tone={PAYMENT_TONE[payment.status] ?? "neutral"}>{payment.status}</Badge>
        {payment.attested ? <span className="section-note"> attested</span> : null}
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
                  "Payment attested. The books were updated.",
                );
              }}
              data-testid={`attest-${payment.paymentId}`}
            >
              Attest receipt
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
