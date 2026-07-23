"use client";

import { Badge, Button, Card, Dialog, EmptyState, useToast, VisuallyHidden } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  rewindFollowerAction,
  runFollowerAction,
  type FinopsResult,
  type ReconciliationWorkspace,
} from "../../../../../server/financial-operations/actions";
import "../../../../seasons/[slug]/money/money.css";
import "../finance.css";

/**
 * PX-8 §3 — the Reconciliation workspace.
 *
 * READ-ONLY financial projections, with exactly two resolving actions, both
 * existing platform capabilities. Reconciliation itself happens in the
 * platform: the follower matches settlement facts into finops, certification
 * re-derives every claim from replay, and evidence re-verifies every seal. This
 * screen renders those verdicts. It computes nothing and matches nothing —
 * there is no client-side reconciliation anywhere on it.
 */

const CHECK_LABEL: Record<string, string> = {
  "replay-deterministic": "Every stream folds the same way twice",
  "projections-match-folds": "The tables agree with the log",
  "documents-reproduce": "Every document re-renders to its sealed digest",
  "exports-verify": "Every export artifact matches its sealed digest",
  "fiscal-evidence-reproduces": "Every sealed year reproduces from replay",
  "settlement-journal-balanced": "Settlement's books balance",
};

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
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const { reconciliation: view, viewer } = workspace;

  const act = async (run: () => Promise<FinopsResult>, done: string): Promise<boolean> => {
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

  const certified = view.certification?.pass === true;

  return (
    <div data-testid="reconciliation-panel" data-hydrated={hydrated ? "true" : "false"}>
      {/* --- Is everything matched? ------------------------------------------- */}
      <Card>
        <div className="competition-title-row">
          <h2>Reconciliation</h2>
          <Badge
            tone={view.certification === null ? "danger" : certified ? "success" : "danger"}
            data-testid="certification-verdict"
          >
            {view.certification === null ? "not derivable" : certified ? "matched" : "not matched"}
          </Badge>
        </div>
        <p className="section-note">
          Certification is re-derived from replay on every read, twice, and fails closed if the two
          derivations disagree. It is never a stored flag — nothing here can be stale.
        </p>
        {view.certification === null ? (
          <p className="section-note" data-testid="certification-nondeterministic">
            The platform could not derive a certification. That means a fold was not deterministic —
            treat it as an incident and do not trust these numbers until it clears.
          </p>
        ) : (
          <ul className="check-list" data-testid="certification-checks">
            {view.certification.checks.map((check) => (
              <li key={check.name}>
                <Badge tone={check.pass ? "success" : "danger"}>
                  {check.pass ? "Matched" : "Failed"}
                </Badge>
                <span>
                  {CHECK_LABEL[check.name] ?? check.name}
                  {check.detail === null ? "" : ` — ${check.detail}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {view.certification !== null ? (
          <p className="freshness">
            <span>
              Digest <strong className="digest">{view.certification.digest.slice(0, 16)}…</strong>
            </span>
          </p>
        ) : null}
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
              Rewind and re-read
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
          <div className="table-scroll">
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
        <h2>Resolution history</h2>
        <p className="section-note">
          Every certification this organization has ever recorded. The latest claim is checked
          against a fresh re-derivation — a recorded digest that replay contradicts is a forged
          certificate, and it is exposed here.
        </p>
        {view.register.history.length === 0 ? (
          <p className="section-note" data-testid="no-history">
            No certification has been recorded yet.
          </p>
        ) : (
          <>
            <p className="section-note" data-testid="claim-verdict">
              <Badge
                tone={
                  view.register.latestClaimMatchesRederivation === null
                    ? "neutral"
                    : view.register.latestClaimMatchesRederivation
                      ? "success"
                      : "danger"
                }
              >
                {view.register.latestClaimMatchesRederivation === null
                  ? "no claim"
                  : view.register.latestClaimMatchesRederivation
                    ? "The latest claim re-derives"
                    : "The latest claim does NOT re-derive"}
              </Badge>
            </p>
            <ul className="audit-rail" data-testid="certification-history">
              {view.register.history.map((row, index) => (
                <li key={`${String(row.atMs)}-${String(index)}`}>
                  <span className="audit-at">{when(row.atMs)}</span>
                  <span className="digest">{row.claim ?? "—"}</span>
                </li>
              ))}
            </ul>
          </>
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
            <dd>{view.compliance.posture ?? "not declared"}</dd>
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
        title="Rewind and re-read settlement"
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
              Rewind and re-read
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
