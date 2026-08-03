"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Tabs,
  useToast,
  VisuallyHidden,
  type BadgeTone,
} from "@desiauction/ui";
import { useEffect, useState } from "react";

import { formatDateTime } from "../../../../../../lib/format-date";
import { replayEvidence, type ReviewView } from "../../../../../../server/settlement/actions";
import { CASE_STATE, PAYMENT_STATE } from "../../money-words";
import "../../money.css";

/**
 * PX-7 E2 — Case review: the audit view.
 *
 * READ-ONLY, entirely. Every number is a fold of the immutable log, every
 * digest is reproducible, and the one button on the page (Replay) writes
 * nothing — it re-derives the sealed evidence and compares it byte-for-byte
 * with what closure sealed. The lifecycle lives on the console; this screen
 * exists to be BELIEVED, not to act.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  opened: "info",
  verified: "info",
  discrepant: "danger",
  settling: "warning",
  settled: "success",
  closed: "success",
  voided: "neutral",
};

const PAYMENT_TONE: Record<string, BadgeTone> = {
  created: "info",
  authorized: "info",
  captured: "success",
  refunded: "neutral",
  failed: "danger",
  disputed: "warning",
};

const METHOD_LABEL: Record<string, string> = {
  "manual:cash": "Cash",
  "manual:upi-direct": "UPI (direct)",
  "manual:bank": "Bank transfer",
  "gateway:razorpay": "Razorpay",
};

/** The sealed evidence fields, in the order a reader should meet them. */
const EVIDENCE_FIELDS: { key: string; label: string; help: string }[] = [
  {
    key: "verificationDigest",
    label: "Verification digest",
    help: "The fingerprint of every closure check and its result.",
  },
  {
    key: "projectionDigest",
    label: "Case digest",
    help: "The fingerprint of the case exactly as it stood at closure.",
  },
  { key: "journalDigest", label: "Journal digest", help: "The fingerprint of the books." },
  { key: "walletDigest", label: "Wallet digest", help: "The fingerprint of every team's wallet." },
  { key: "paymentDigest", label: "Payment digest", help: "The fingerprint of every payment." },
  {
    key: "trialBalanceDigest",
    label: "Trial balance digest",
    help: "The fingerprint of the balanced books.",
  },
  {
    key: "caseEventCount",
    label: "Case events sealed",
    help: "How much of the case history the evidence stands on.",
  },
  {
    key: "journalSeq",
    label: "Journal position",
    help: "How far down the books the evidence stands on.",
  },
];

function inr(value: number): string {
  return formatPaiseINR(paise(value));
}

function Amount({ value }: { value: number }) {
  return <span title={`${String(value)} paise`}>{inr(value)}</span>;
}

/**
 * Pinned locale AND zone. A bare `toLocaleString("en-IN", …)` reads the HOST
 * time zone, which differs between the SSR render and the browser — the
 * hydration-mismatch class `lib/format-date` exists to close.
 */
function when(atMs: number): string {
  return formatDateTime(atMs);
}

export function CasePanel({
  slug,
  review,
  initialTab,
}: {
  slug: string;
  review: ReviewView;
  initialTab: string;
}) {
  const { case: settlementCase, ceremony, readiness } = review;
  // The repo idiom: a tab click before hydration is a no-op, so the surface
  // announces when it is actually interactive (M-IP4-1 panels do the same).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div data-testid="case-panel" data-hydrated={hydrated ? "true" : "false"}>
      <Card>
        <div className="competition-title-row">
          <div>
            <h2>Case {settlementCase.caseId.slice(-8)}</h2>
            <p className="section-note">
              Opened {when(Date.parse(settlementCase.openedAt))} against auction{" "}
              {settlementCase.auctionId.slice(-8)}
              {settlementCase.closures > 0
                ? ` · closed ${String(settlementCase.closures)} time${settlementCase.closures === 1 ? "" : "s"}`
                : ""}
              {settlementCase.reopenings > 0
                ? ` · reopened ${String(settlementCase.reopenings)} time${settlementCase.reopenings === 1 ? "" : "s"}`
                : ""}
              {settlementCase.recoveries > 0
                ? ` · recovered ${String(settlementCase.recoveries)} time${settlementCase.recoveries === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>
          <Badge tone={STATUS_TONE[settlementCase.status] ?? "neutral"} data-testid="review-status">
            {CASE_STATE[settlementCase.status] ?? settlementCase.status}
          </Badge>
        </div>
        <div className="stat-row">
          <Tile label="Total dues" value={settlementCase.financial.totalObligations} id="r-total" />
          <Tile label="Collected" value={settlementCase.financial.discharged} id="r-collected" />
          <Tile label="Waived" value={settlementCase.financial.waived} id="r-waived" />
          <Tile
            label="Outstanding"
            value={settlementCase.financial.outstanding}
            id="r-outstanding"
          />
          {/* Recorded, not yet confirmed — real money that moves no tile on the
              books, and so used to move nothing on any screen either. */}
          {settlementCase.pending > 0 ? (
            <Tile label="Awaiting confirmation" value={settlementCase.pending} id="r-pending" />
          ) : null}
        </div>
      </Card>

      {settlementCase.status === "discrepant" ? (
        <Card>
          <Badge tone="danger">Discrepant</Badge>
          <p className="section-note">
            The auction log no longer matches the pin this case took when it opened. Money is frozen
            until a controller re-verifies from the console.
          </p>
        </Card>
      ) : null}

      <Card>
        <Tabs
          label="Case review sections"
          defaultTabId={initialTab}
          onSelect={(id) => {
            // Keep the tab in the URL so a reviewer can send someone straight to
            // the evidence (CTO §8 deep links) without losing their place on refresh.
            const url = new URL(window.location.href);
            url.searchParams.set("tab", id);
            window.history.replaceState(null, "", url);
          }}
          tabs={[
            {
              id: "obligations",
              label: "Obligations",
              content: <ObligationsTab review={review} />,
            },
            { id: "payments", label: "Payments", content: <PaymentsTab review={review} /> },
            { id: "timeline", label: "Timeline", content: <TimelineTab review={review} /> },
            {
              id: "verification",
              label: "Verification",
              content: <VerificationTab review={review} readiness={readiness} />,
            },
            {
              id: "evidence",
              label: "Evidence",
              content: <EvidenceTab slug={slug} review={review} ceremony={ceremony} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}

function Tile({ label, value, id }: { label: string; value: number; id: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-value" data-testid={id}>
        <Amount value={value} />
      </span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

// --- Obligations --------------------------------------------------------------------

function ObligationsTab({ review }: { review: ReviewView }) {
  const rows = review.case.obligations;
  if (rows.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title="No obligations yet"
        description="Obligations appear once the case is verified and computed."
      />
    );
  }
  return (
    <div
      className="table-scroll money-scroll"
      tabIndex={0}
      role="region"
      aria-label="Every team's obligation"
    >
      <table className="money-table" data-testid="review-obligations">
        <caption>
          <VisuallyHidden>Every team's obligation, with adjustments and waivers</VisuallyHidden>
        </caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" className="num">
              Computed
            </th>
            <th scope="col" className="num">
              Waived
            </th>
            <th scope="col" className="num">
              Collected
            </th>
            <th scope="col" className="num">
              Reinstated
            </th>
            <th scope="col" className="num">
              Outstanding
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.teamId} data-testid={`review-obligation-${row.teamId}`}>
              {/* The team is the row header: without it a screen reader reads
                  "Outstanding, ₹80,000" and never says whose. */}
              <th scope="row" data-label="Team">
                {row.teamName}
              </th>
              <td data-label="Computed" className="num">
                <Amount value={row.amount} />
              </td>
              <td data-label="Waived" className="num">
                <Amount value={row.waived} />
              </td>
              <td data-label="Collected" className="num">
                <Amount value={row.discharged} />
              </td>
              <td data-label="Reinstated" className="num">
                <Amount value={row.reinstated} />
              </td>
              <td data-label="Outstanding" className="num">
                {row.outstanding === 0 ? (
                  <Badge tone="success">Clear</Badge>
                ) : (
                  <Amount value={row.outstanding} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Payments -----------------------------------------------------------------------

function PaymentsTab({ review }: { review: ReviewView }) {
  const rows = review.case.payments;
  if (rows.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title="No payments recorded"
        description="Every payment recorded against this case will appear here with its method, status and evidence."
      />
    );
  }
  return (
    <div
      className="table-scroll money-scroll"
      tabIndex={0}
      role="region"
      aria-label="Every payment against this case"
    >
      <table className="money-table" data-testid="review-payments">
        <caption>
          <VisuallyHidden>Every payment against this case</VisuallyHidden>
        </caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col">Recorded</th>
            <th scope="col">Reference</th>
            <th scope="col">Method</th>
            <th scope="col">State</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col" className="num">
              Collected
            </th>
            <th scope="col" className="num">
              Refunded
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.paymentId} data-testid={`review-payment-${row.paymentId}`}>
              <th scope="row" data-label="Team">
                {row.teamName}
              </th>
              <td data-label="Recorded" className="money-when">
                {when(Date.parse(row.recordedAt))}
              </td>
              <td data-label="Reference">
                <span className="digest">{row.providerRef ?? row.paymentId.slice(-10)}</span>
              </td>
              <td data-label="Method">{METHOD_LABEL[row.method] ?? row.method}</td>
              <td data-label="State">
                <Badge tone={PAYMENT_TONE[row.status] ?? "neutral"}>
                  {PAYMENT_STATE[row.status] ?? row.status}
                </Badge>
                {/* `attestedBy` was fetched on every read and rendered nowhere,
                    while the action's own copy promised the money was "recorded
                    against your name". */}
                {row.attested ? (
                  <span className="section-note">
                    {" "}
                    confirmed by hand by {row.attestedByName ?? "a settlement controller"}
                  </span>
                ) : null}
              </td>
              <td data-label="Amount" className="num">
                <Amount value={row.amount} />
              </td>
              <td data-label="Collected" className="num">
                <Amount value={row.captured} />
              </td>
              <td data-label="Refunded" className="num">
                <Amount value={row.refundedTotal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Timeline -----------------------------------------------------------------------

function TimelineTab({ review }: { review: ReviewView }) {
  const rows = review.audit.timeline;
  return (
    <>
      <p className="section-note">
        Every event on this case, in the order it happened. This is the log itself — it is never
        rewritten, and the numbers above are folded from exactly these rows.
      </p>
      <ul className="timeline" data-testid="review-timeline">
        {rows.map((row) => (
          <li key={row.seq} data-testid={`timeline-${String(row.seq)}`}>
            <span className="timeline-at">
              #{row.seq} · {when(row.atMs)}
            </span>
            <span className="timeline-note">
              {row.headline}
              <span className="section-note"> — {row.actor}</span>
            </span>
            {/* The log records WHY an override happened; the desk shows it. */}
            {row.reason !== null ? (
              <span className="timeline-reason" data-testid={`timeline-reason-${String(row.seq)}`}>
                “{row.reason}”
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Verification -------------------------------------------------------------------

const CHECK_LABEL: Record<string, string> = {
  case_settled: "The case is settled",
  no_outstanding: "No team still owes money",
  trial_balance_zero: "The books balance",
  dues_cleared: "Every team's dues are clear",
  no_refund_liability: "No refund is owed",
  obligations_match_source: "The obligations still match the auction",
  collections_reconcile: "The collections reconcile",
};

function VerificationTab({
  review,
  readiness,
}: {
  review: ReviewView;
  readiness: ReviewView["readiness"];
}) {
  const { case: settlementCase } = review;
  return (
    <>
      <h3>Verification history</h3>
      <dl className="evidence-grid">
        <div>
          <dt>Auction pin</dt>
          <dd>
            {settlementCase.sourceEventCount} events ·{" "}
            <span className="digest">{settlementCase.sourceDigest.slice(0, 16)}…</span>
          </dd>
        </div>
        <div>
          <dt>Verified fold</dt>
          <dd>
            {settlementCase.foldDigest === null ? (
              <span className="section-note">Not verified yet</span>
            ) : (
              <span className="digest">{settlementCase.foldDigest.slice(0, 16)}…</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="section-note">
        The pin is what the frozen auction log looked like when this case first trusted it.
        Verification re-reads the log and proves it still folds to the same fingerprint.
      </p>

      {/*
       * The checks that justified closing used to VANISH at the moment they
       * became the record: `readiness` is computed only while a case is
       * `settled`, so the closed case — the one whose checks matter for ever —
       * showed none. Closure is structurally impossible unless every check
       * passes (packages/settlement closure refuses on the first failure), so
       * on a closed case each one passed, and the verification digest on the
       * Evidence tab is the reproducible proof of exactly that.
       */}
      {settlementCase.status === "closed" ? (
        <>
          <h3>Closure checks</h3>
          <p className="section-note">
            Every check below passed when this case closed — closure refuses outright on the first
            failure, so a closed case is a case that cleared all of them. Their result is
            fingerprinted in the verification digest on the Evidence tab, and Replay re-runs them
            against the log.
          </p>
          <ul className="check-list" data-testid="review-sealed-checks">
            {Object.entries(CHECK_LABEL).map(([key, label]) => (
              <li key={key}>
                <Badge tone="success">Passed</Badge>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {readiness !== null ? (
        <>
          <h3>Closure checks</h3>
          {readiness.ready ? (
            <p className="section-note" data-testid="review-ready">
              Every closure check passes. This case is ready to close from the console.
            </p>
          ) : (
            <ul className="check-list" data-testid="review-blockers">
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>
                  <Badge tone="danger">Blocked</Badge>
                  <span>{CHECK_LABEL[blocker] ?? blocker}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <h3>The books this case touched</h3>
      {review.audit.journal.length === 0 ? (
        <p className="section-note">No money has moved on this case yet.</p>
      ) : (
        <div
          className="table-scroll money-scroll"
          tabIndex={0}
          role="region"
          aria-label="Accounts this case moved"
        >
          <table className="money-table" data-testid="review-journal">
            <caption>
              <VisuallyHidden>Accounts this case moved, with debits and credits</VisuallyHidden>
            </caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="num">
                  Debit
                </th>
                <th scope="col" className="num">
                  Credit
                </th>
              </tr>
            </thead>
            <tbody>
              {review.audit.journal.map((line) => (
                <tr key={line.account}>
                  {/* `dues:01KYAF06VBRK9DXMD5Q3G550E3:01KYAF06W2Q2Q1V5C7C0N8SZ7X`
                      is a correct account code and is not language. The code
                      stays — an auditor reconciles against the literal string —
                      but it is no longer the only thing on the row. */}
                  <th scope="row" data-label="Account">
                    {line.label}
                    <br />
                    <span className="digest">{line.account}</span>
                  </th>
                  <td data-label="Debit" className="num">
                    <Amount value={line.debit} />
                  </td>
                  <td data-label="Credit" className="num">
                    <Amount value={line.credit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// --- Evidence + replay --------------------------------------------------------------

function EvidenceTab({
  slug,
  review,
  ceremony,
}: {
  slug: string;
  review: ReviewView;
  ceremony: ReviewView["ceremony"];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState<{ matches: boolean; ok: boolean } | null>(null);
  const evidence = review.case.evidence;

  if (evidence === null) {
    return (
      <EmptyState
        headingLevel={3}
        title="No evidence sealed yet"
        description="Closing the case runs the full financial verification and seals an evidence package here — one that can be replayed and checked against the log for ever."
      />
    );
  }

  return (
    <>
      <h3>Closure evidence</h3>
      <p className="section-note">
        Sealed when the case closed. Every fingerprint below is reproducible: replay re-folds the
        same history and must arrive at exactly these values.
      </p>
      <dl className="evidence-grid" data-testid="evidence-grid">
        {EVIDENCE_FIELDS.map((field) => {
          const value = evidence[field.key];
          if (value === undefined) {
            return null;
          }
          // The evidence package is sealed JSON: render what is actually there,
          // never a stringified guess. An unexpected shape shows as its JSON.
          const text =
            typeof value === "string" || typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : JSON.stringify(value);
          return (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd className="digest" data-testid={`evidence-${field.key}`}>
                {text}
              </dd>
              <dd className="section-note">{field.help}</dd>
            </div>
          );
        })}
      </dl>

      <h3>Replay verification</h3>
      <p className="section-note">
        Replay re-reads the sealed history from the beginning, re-runs every closure check, and
        compares the result with what was sealed. It changes nothing — run it as often as you like.
      </p>
      <Button
        onClick={() => {
          setBusy(true);
          void replayEvidence(slug, review.case.caseId).then((result) => {
            setBusy(false);
            if (result === null) {
              toast({ title: "That case could not be replayed.", tone: "danger" });
              return;
            }
            setReplay({ matches: result.matches, ok: result.ok });
            toast({
              title: result.matches
                ? "Replay matches the sealed evidence exactly."
                : "Replay did NOT match the sealed evidence.",
              tone: result.matches ? "success" : "danger",
            });
          });
        }}
        disabled={busy}
        loading={busy}
        data-testid="replay-evidence"
      >
        Replay the evidence
      </Button>
      {replay !== null ? (
        <p className="check-list" data-testid="replay-result" data-matches={replay.matches}>
          {replay.matches ? (
            <>
              <Badge tone="success">Verified</Badge> The evidence reproduced byte-for-byte from the
              log. Nothing has been altered since this case closed.
            </>
          ) : (
            <>
              <Badge tone="danger">Mismatch</Badge> The replay did not reproduce the sealed
              evidence. Do not trust this closure — raise it immediately.
            </>
          )}
        </p>
      ) : null}

      {ceremony !== null && ceremony.overlay.reconciled ? (
        <p className="section-note" data-testid="reconciled-note">
          This auction reads as <strong>Reconciled</strong> — closed at case event{" "}
          {ceremony.overlay.closedAtSeq ?? "—"}.
        </p>
      ) : null}
    </>
  );
}
