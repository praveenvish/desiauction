"use client";

import { Badge, Button, Card, Dialog, EmptyState, VisuallyHidden } from "@desiauction/ui";
import { useEffect, useState } from "react";

import { useFinopsAct } from "../use-finops-act";
import {
  rewindFollowerAction,
  runFollowerAction,
  type ReconciliationWorkspace,
} from "../../../../../server/financial-operations/actions";
import { postureLabel } from "../../../../../server/financial-operations/register";
import "../../../../seasons/[slug]/money/money.css";
import "../finance.css";

/**
 * PX-8 §3 — the Reconciliation workspace.
 *
 * READ-ONLY financial projections, with exactly two resolving actions, both
 * existing platform capabilities. Reconciliation itself happens in the
 * platform: the follower matches settlement facts into finops, the job runner
 * certifies by replaying every claim, and evidence re-verifies every seal. This
 * screen renders those verdicts. It computes nothing and matches nothing —
 * there is no client-side reconciliation anywhere on it.
 *
 * "READ-ONLY" is now true of the database as well as the screen. It was not:
 * certification used to be derived by the act of rendering, and that derivation
 * writes an audit row, so every page view appended two of them.
 */

/**
 * What a certification actually checks, in words. These used to be rendered one
 * per row with a live Matched/Failed badge beside it — but the verdicts came
 * from a derivation performed BY the page load, and on an organization with
 * nothing in it they read "Every document re-renders to its sealed digest —
 * 0 verified" under a green badge: six reassurances over an empty set. Vacuous
 * truth presented as assurance teaches an operator to stop reading the badge.
 *
 * They are now what they always were — a description of the runner's job.
 */
const CERTIFICATION_CHECKS: readonly string[] = [
  "Every stream folds the same way twice",
  "The tables agree with the log",
  "Every document re-renders to its sealed digest",
  "Every export artifact matches its sealed digest",
  "Every sealed year reproduces from replay",
  "Settlement's books balance",
];

function when(atMs: number): string {
  return new Date(atMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function ReconciliationPanel({
  slug,
  workspace,
}: {
  slug: string;
  workspace: ReconciliationWorkspace;
}) {
  const [rewinding, setRewinding] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const { reconciliation: view, viewer } = workspace;

  const { busy, act, outcomeNote } = useFinopsAct();

  const latest = view.certifications[0] ?? null;

  return (
    <div data-testid="reconciliation-panel" data-hydrated={hydrated ? "true" : "false"}>
      {/* Where focus lands after a command, and what it says. */}
      {outcomeNote}
      {/* --- Is everything matched? -------------------------------------------
          This card used to derive a FRESH certification on every render, and
          say so proudly: "re-derived from replay on every read, twice ...
          nothing here can be stale". The intent was right, but the derivation
          writes an audit row inside its own transaction, so simply opening this
          page appended two `finops.CertificationDerived` entries stamped with
          the job runner's name — and the card below then displayed those page
          views back as the organization's certification history.

          Certifying is an act, and it belongs to the runner. So this reads what
          the runner recorded and nothing more. That trades freshness for not
          forging the record, which means a verdict here CAN now be stale — so
          the age is stated rather than hidden, which is the honest version of
          the guarantee the old copy was making. */}
      <Card>
        <div className="competition-title-row">
          <h2>Reconciliation</h2>
          <Badge
            tone={latest === null ? "neutral" : latest.pass === true ? "success" : "danger"}
            data-testid="certification-verdict"
          >
            {latest === null
              ? "not certified yet"
              : latest.pass === true
                ? "matched"
                : "not matched"}
          </Badge>
        </div>
        {latest === null ? (
          <p className="section-note" data-testid="certification-none">
            The job runner certifies this organization&rsquo;s books by replaying them and comparing
            the result against the last sealed digest. It has not recorded a certification yet — so
            there is nothing to show here, rather than nothing wrong.
          </p>
        ) : (
          <>
            <p className="section-note">
              What the job runner found when it last replayed this organization&rsquo;s books. It is
              a record of that run, not a live check — if the date below is old, the verdict is old
              too.
            </p>
            <p className="freshness" data-testid="certification-record">
              <span>
                Certified <strong>{when(latest.atMs)}</strong>
              </span>
              {latest.digest === null ? null : (
                <span>
                  Digest <strong className="digest">{latest.digest.slice(0, 16)}…</strong>
                </span>
              )}
            </p>
            {latest.pass === false ? (
              <p className="section-note" data-testid="certification-failed">
                The books did not reconcile on that run. Treat it as an incident and do not rely on
                these numbers until it clears.
              </p>
            ) : null}
          </>
        )}
        <details className="section-note">
          <summary>What a certification checks</summary>
          <ul className="check-list" data-testid="certification-checks">
            {CERTIFICATION_CHECKS.map((check) => (
              <li key={check}>
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>

      {/* --- Pending: the ingest frontier -------------------------------------- */}
      <Card>
        <h2>Settlement ingest</h2>
        <p className="section-note">
          Finance follows settlement — it never writes to it. Anything settlement has recorded but
          finance has not yet consumed is <strong>pending</strong>: not lost, just not here yet.
        </p>
        <div className="stat-row">
          <Tile label="Streams followed" value={String(view.follower.streams)} id="stat-streams" />
          <Tile
            label="Events pending"
            value={String(view.follower.totalBehind)}
            id="stat-pending"
          />
          <Tile
            label="Last consumed"
            value={
              view.follower.lastConsumedAtMs === null
                ? "never"
                : when(view.follower.lastConsumedAtMs)
            }
            id="stat-consumed"
          />
        </div>
        {view.follower.stalled.length > 0 ? (
          <ul className="attention-list" data-testid="stalled-list">
            {view.follower.stalled.map((lag) => (
              <li className="attention-item" key={`${lag.streamType}:${lag.streamId}`}>
                <span className="attention-subject">
                  <span className="digest">
                    {lag.streamType}:{lag.streamId.slice(-8)}
                  </span>{" "}
                  is {lag.behind} event{lag.behind === 1 ? "" : "s"} behind
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="section-note" data-testid="ingest-current">
            Finance has consumed everything settlement has recorded.
          </p>
        )}
        {viewer.canOperate ? (
          <div className="money-row-actions" style={{ justifyContent: "flex-start" }}>
            <Button
              disabled={busy}
              onClick={() => {
                void act(() => runFollowerAction(slug), "Ingest run. Finance is caught up.");
              }}
              data-testid="run-follower"
            >
              Run ingest now
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setRewinding(true);
              }}
              data-testid="open-rewind"
            >
              Rebuild from settlement
            </Button>
          </div>
        ) : (
          <p className="section-note">Resolving a stalled ingest needs the operate permission.</p>
        )}
      </Card>

      {/* --- Failed: the ranked queue ------------------------------------------ */}
      <Card>
        <h2>Needs investigation</h2>
        {view.queue.items.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="Nothing failed"
            description="No component is unhealthy, no delivery failed and no artifact is unverified."
          />
        ) : (
          <ul className="attention-list" data-testid="investigate-list">
            {view.queue.items.map((item, index) => (
              <li className="attention-item" key={`${item.kind}-${String(index)}`}>
                <span>
                  <Badge tone="danger">{item.kind}</Badge>{" "}
                  <span className="attention-subject">{item.subject}</span>
                </span>
                <span className="attention-action">{item.action}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- Evidence: every seal, re-verified live ---------------------------- */}
      <Card>
        <h2>Evidence</h2>
        <p className="section-note">
          Each sealed fiscal year is re-verified from the log every time this page loads — a seal
          that no longer reproduces is shown as failed, not hidden.
        </p>
        {view.evidence.seals.length === 0 ? (
          <p className="section-note" data-testid="no-seals">
            No fiscal year has been sealed yet.
          </p>
        ) : (
          <div
            className="table-scroll money-scroll"
            tabIndex={0}
            role="region"
            aria-label="Sealed fiscal years"
          >
            <table className="money-table" data-testid="evidence-table">
              <caption>
                <VisuallyHidden>Every fiscal-year seal, re-verified</VisuallyHidden>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fiscal year</th>
                  <th scope="col">Sealed at event</th>
                  <th scope="col">Reproduces</th>
                </tr>
              </thead>
              <tbody>
                {view.evidence.seals.map((seal) => (
                  <tr
                    key={`${seal.periodId}-${String(seal.closedAtSeq)}`}
                    data-testid={`seal-${seal.fy}`}
                  >
                    <td data-label="Fiscal year">{seal.fy}</td>
                    <td data-label="Sealed at event">#{seal.closedAtSeq}</td>
                    <td data-label="Reproduces">
                      <Badge tone={seal.verified ? "success" : "danger"}>
                        {seal.verified ? "Verified" : "MISMATCH"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* --- Audit trail: the resolution history -------------------------------- */}
      <Card>
        <h2>Certification history</h2>
        <p className="section-note">
          {/* Was "Every certification this organization has ever recorded" —
              which was false while opening the page created two of them. */}
          Every certification the job runner has recorded for this organization, newest first.
        </p>
        {view.certifications.length === 0 ? (
          <p className="section-note" data-testid="no-history">
            No certification has been recorded yet.
          </p>
        ) : (
          <ul className="audit-rail" data-testid="certification-history">
            {view.certifications.map((row, index) => (
              <li key={`${String(row.atMs)}-${String(index)}`}>
                <span className="audit-at">{when(row.atMs)}</span>
                <span className="digest">{row.claim ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- Compliance posture ------------------------------------------------ */}
      <Card>
        <h2>Posture</h2>
        <dl className="kv-grid" data-testid="posture-grid">
          <div>
            <dt>Fiscal year</dt>
            <dd>{view.fy}</dd>
          </div>
          <div>
            <dt>Tax posture</dt>
            <dd>{postureLabel(view.compliance.posture)}</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>
              {view.compliance.period.status ?? "not opened"}
              {view.compliance.period.openExceptions > 0
                ? ` · ${String(view.compliance.period.openExceptions)} open exception(s)`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>
              {view.compliance.documents.total} ·{" "}
              {view.compliance.documents.reproducible ? "all reproduce" : "some do not reproduce"}
            </dd>
          </div>
        </dl>
      </Card>

      <Dialog
        open={rewinding}
        onClose={() => {
          setRewinding(false);
        }}
        title="Rebuild finance from settlement"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRewinding(false);
              }}
            >
              Back
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void act(
                  () => rewindFollowerAction(slug),
                  "Rewound and re-read. Finance is rebuilt from settlement.",
                ).then((ok) => {
                  if (ok) {
                    setRewinding(false);
                  }
                });
              }}
              data-testid="confirm-rewind"
            >
              Rebuild from settlement
            </Button>
          </>
        }
      >
        <p className="section-note">
          This drops this organization&apos;s ingest position and re-reads settlement from the
          beginning. It is safe — every effect is keyed to its source, so nothing is duplicated —
          but on a large organization it is not quick, and it is recorded against your name.
        </p>
        <p className="section-note">
          Use it when the ingest is stuck or when finance and settlement disagree. It does not
          change settlement, which stays the authority.
        </p>
      </Dialog>
    </div>
  );
}

function Tile({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-value" data-testid={id}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
