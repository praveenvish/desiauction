"use client";

import type { EngineDiagnostics } from "@desiauction/contracts";
import { Badge, Button, Card, useToast } from "@desiauction/ui";
import { useCallback, useEffect, useState } from "react";

import { engineDiagnosticsAction } from "../../../../../server/auction/conduct-actions";
import { submitAuctionCommand } from "../../../../../server/auction/live-actions";

// RECOVERY DASHBOARD + ENGINE DIAGNOSTICS (M-IP4-3). Everything read-only,
// polled from the engine's diagnostics feed through the conduct-gated proxy.
// The one button — Recover — is a COMMAND like everything else.

const POLL_MS = 2_000;

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

export function EnginePanel({ slug }: { slug: string }) {
  const toast = useToast();
  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);
  const [refreshMs, setRefreshMs] = useState<number | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const refresh = useCallback(async () => {
    const started = performance.now();
    const result = await engineDiagnosticsAction(slug);
    setRefreshMs(performance.now() - started);
    if (result.ok) {
      setDiagnostics(result.diagnostics);
      setUnreachable(false);
    } else {
      setUnreachable(true);
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [refresh]);

  const recover = async () => {
    setBusy(true);
    const ack = await submitAuctionCommand(slug, crypto.randomUUID(), "RecoverAuction", {});
    setBusy(false);
    if (ack.accepted) {
      toast({ title: `Recovered: ${ack.reason ?? "verified"}`, tone: "success" });
    } else {
      toast({ title: `Rejected: ${ack.reason ?? "unknown"}`, tone: "danger" });
    }
    await refresh();
  };

  const healthy =
    diagnostics !== null && diagnostics.halted === null && !diagnostics.watchdog.stalled;

  return (
    <div
      className="competitions-stack"
      data-testid="engine-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <Card data-testid="recovery-status">
        <div className="competition-head">
          <h2>Engine health</h2>
          <span className="date-row">
            {unreachable ? (
              <Badge tone="danger" data-testid="engine-unreachable">
                engine unreachable
              </Badge>
            ) : diagnostics !== null ? (
              <Badge tone={healthy ? "success" : "danger"} data-testid="engine-health">
                {healthy ? "healthy" : "attention required"}
              </Badge>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void recover()}
              loading={busy}
              data-testid="engine-recover"
            >
              Recover engine
            </Button>
          </span>
        </div>
        {diagnostics?.halted != null ? (
          <p className="competitions-hint diag-fail" data-testid="engine-halted">
            HALTED FAIL-CLOSED: {diagnostics.halted}
          </p>
        ) : (
          <p className="competitions-hint">
            Fail-closed discipline: a lying snapshot is never served. Recovery replays the immutable
            log and heals row projections from it.
          </p>
        )}
      </Card>

      {diagnostics !== null ? (
        <>
          <Card data-testid="recovery-dashboard">
            <h2>Recovery dashboard</h2>
            <div className="diag-grid">
              <Tile
                label="Snapshot version"
                value={String(diagnostics.version)}
                testId="diag-version"
              />
              <Tile
                label="Event sequence"
                value={String(diagnostics.eventCount)}
                testId="diag-events"
              />
              <Tile
                label="Replay (fold + verify)"
                value={ms(diagnostics.lastReplayMs)}
                testId="diag-replay"
              />
              <Tile
                label="Recovery duration"
                value={diagnostics.lastRecoveryMs > 0 ? ms(diagnostics.lastRecoveryMs) : "—"}
                testId="diag-recovery"
              />
              <Tile
                label="Queue depth"
                value={String(diagnostics.queueDepth)}
                testId="diag-queue"
              />
              <Tile
                label="Recovery status"
                value={diagnostics.halted === null ? "verified" : "halted"}
                tone={diagnostics.halted === null ? "ok" : "fail"}
                testId="diag-recovery-status"
              />
              <Tile
                label="Watchdog"
                value={diagnostics.watchdog.stalled ? "stalled" : "ticking"}
                tone={diagnostics.watchdog.stalled ? "fail" : "ok"}
                testId="diag-watchdog"
              />
              <Tile
                label="Connected clients"
                value={String(diagnostics.connectedClients)}
                testId="diag-clients"
              />
              <Tile
                label="WS heartbeat age"
                value={
                  diagnostics.wsHeartbeatAgeMs === 0
                    ? "—"
                    : `${(diagnostics.wsHeartbeatAgeMs / 1000).toFixed(1)} s`
                }
                testId="diag-heartbeat"
              />
              <Tile
                label="Projection status"
                value={
                  diagnostics.halted?.startsWith("projection_mismatch") === true
                    ? "diverged"
                    : "verified"
                }
                tone={
                  diagnostics.halted?.startsWith("projection_mismatch") === true ? "fail" : "ok"
                }
                testId="diag-projection"
              />
              <Tile
                label="Recoveries"
                value={String(diagnostics.recoveries)}
                testId="diag-recoveries"
              />
            </div>
          </Card>

          <Card data-testid="diagnostics-card">
            <h2>Diagnostics</h2>
            <div className="diag-grid">
              <Tile
                label="Commands processed"
                value={`${String(diagnostics.processed)} (${String(diagnostics.rejected)} rejected)`}
                testId="diag-processed"
              />
              <Tile
                label="Throughput"
                value={`${diagnostics.commandsPerMinute.toFixed(1)}/min`}
                testId="diag-throughput"
              />
              <Tile label="Avg processing" value={ms(diagnostics.avgProcessMs)} testId="diag-avg" />
              <Tile label="Max processing" value={ms(diagnostics.maxProcessMs)} testId="diag-max" />
              <Tile
                label="Broadcast latency"
                value={ms(diagnostics.lastBroadcastLatencyMs)}
                testId="diag-broadcast"
              />
              <Tile
                label="Engine drift (tick)"
                value={`${String(diagnostics.watchdog.tickDriftMs)} ms`}
                testId="diag-drift"
              />
              <Tile
                label="Diagnostics refresh"
                value={refreshMs !== null ? ms(refreshMs) : "—"}
                testId="diag-refresh"
              />
            </div>
            <div className="diag-grid">
              <div className="diag-tile">
                <span className="diag-value diag-hash" data-testid="diag-snapshot-hash">
                  {diagnostics.snapshotHash.slice(0, 16)}…
                </span>
                <span className="diag-label">Snapshot hash (sha-256 of broadcast bytes)</span>
              </div>
              <div className="diag-tile">
                <span className="diag-value diag-hash" data-testid="diag-projection-hash">
                  {diagnostics.projectionHash.slice(0, 16)}…
                </span>
                <span className="diag-label">Projection hash (sha-256 of the fold)</span>
              </div>
            </div>
          </Card>
        </>
      ) : !unreachable ? (
        <Card>
          <p className="competitions-hint">Loading diagnostics…</p>
        </Card>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "fail";
  testId: string;
}) {
  return (
    <div className="diag-tile">
      <span
        className={`diag-value${tone !== undefined ? ` diag-${tone}` : ""}`}
        data-testid={testId}
      >
        {value}
      </span>
      <span className="diag-label">{label}</span>
    </div>
  );
}
