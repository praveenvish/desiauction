"use client";

import type { EngineDiagnostics } from "@desiauction/contracts";
import { commandRefusalMessage } from "@desiauction/core";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  IconAlert,
  IconGavel,
  IconList,
  IconPlay,
  IconRefresh,
  IconShieldCheck,
  useToast,
} from "@desiauction/ui";
import { useCallback, useEffect, useState } from "react";

import { engineDiagnosticsAction } from "../../../../../server/auction/conduct-actions";
import { submitAuctionCommand } from "../../../../../server/auction/live-actions";
import { useHydrated } from "../../../../../lib/use-hydrated";
import { usePolled } from "../../../../admin/use-polled";

// RECOVERY DASHBOARD + ENGINE DIAGNOSTICS (M-IP4-3). Everything read-only,
// polled from the engine's diagnostics feed through the conduct-gated proxy.
// The one button — Recover — is a COMMAND like everything else.

const POLL_MS = 2_000;

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

/** One answer from the diagnostics feed, stamped so the newer of two wins. */
interface Reading {
  diagnostics: EngineDiagnostics | null;
  unreachable: boolean;
  refreshMs: number | null;
  at: number;
}

const NOT_YET: Reading = { diagnostics: null, unreachable: false, refreshMs: null, at: 0 };

/** What the page already knows from the record, before the engine answers. */
export interface EngineRecord {
  status: string;
  events: number;
  lots: number;
}

const STATUS_WORD: Record<string, string> = {
  draft: "Not started",
  scheduled: "Scheduled",
  open: "Live",
  paused: "Paused",
  completed: "Completed",
  reconciled: "Completed",
  abandoned: "Abandoned",
};

export function EnginePanel({ slug, record }: { slug: string; record?: EngineRecord }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hydrated = useHydrated();

  // Null only when the gate refuses (the conduct grant is gone): usePolled then
  // stops asking, rather than polling a refusal every two seconds all night.
  const read = useCallback(async (): Promise<Reading | null> => {
    const started = performance.now();
    const result = await engineDiagnosticsAction(slug);
    const at = performance.now();
    if (result.ok) {
      return { diagnostics: result.diagnostics, unreachable: false, refreshMs: at - started, at };
    }
    if (result.reason === "not_authorized") {
      return null;
    }
    return { diagnostics: null, unreachable: true, refreshMs: at - started, at };
  }, [slug]);

  // The shared poller (admin live board, auction watch): it pauses while the
  // tab is hidden and never overlaps a slow answer with the next request. The
  // hand-rolled setInterval here did neither — a dashboard left open in a
  // background tab through an auction night asked the engine every 2 s, and a
  // slow engine got a second request stacked on the first (go-live gate P3).
  const polled = usePolled(NOT_YET, read, POLL_MS, true);

  // The poller's first answer comes a full interval after mount, and a
  // recovery wants its result at once — so an on-demand read sits beside it,
  // and whichever answer is newer is the one on screen.
  const [manual, setManual] = useState<Reading>(NOT_YET);
  const refresh = useCallback(
    (): Promise<void> =>
      read().then((reading) => {
        if (reading !== null) {
          setManual(reading);
        }
      }),
    [read],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latest = manual.at > polled.data.at ? manual : polled.data;
  const diagnostics = latest.diagnostics;
  const refreshMs = latest.refreshMs;
  // A thrown read (the server action itself failed) or a refused one keeps the
  // last numbers but says the engine could not be reached, as a refused read
  // always did.
  const unreachable = latest.unreachable || polled.failed || polled.revoked;

  const recover = async () => {
    setConfirmOpen(false);
    setBusy(true);
    const ack = await submitAuctionCommand(slug, crypto.randomUUID(), "RecoverAuction", {});
    setBusy(false);
    if (ack.accepted) {
      toast({ title: `Recovered: ${ack.reason ?? "verified"}`, tone: "success" });
    } else {
      toast({ title: commandRefusalMessage(ack.reason), tone: "danger" });
    }
    await refresh();
  };

  const healthy =
    diagnostics !== null && diagnostics.halted === null && !diagnostics.watchdog.stalled;
  /* Recovery replays the log and heals the projections — a live-room repair.
     On a finished auction there is no room to repair, and the button used to
     sit there enabled all the same. */
  const status = diagnostics?.auctionStatus ?? record?.status;
  const finished = status === "completed" || status === "reconciled" || status === "abandoned";
  /* A finished auction with no engine answering is not an incident: the
     engine only matters while a room is live, and the record is sealed. */
  const restful = finished && unreachable;

  return (
    <div
      className="competitions-stack"
      data-testid="engine-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      {/* THE ORGANIZER'S ANSWER, first and alone: is the engine all right?
          Seventeen mono tiles used to BE the page ("1047861 ms Engine drift"
          read like an alarm on a healthy engine). They are still here, behind
          "Technical diagnostics", for whoever is asked to look. */}
      <Card data-testid="recovery-status" className="engine-health">
        <span
          className="engine-health-tile"
          data-tone={
            restful ? "ok" : unreachable || (diagnostics !== null && !healthy) ? "danger" : "ok"
          }
          aria-hidden
        >
          {!restful && (unreachable || (diagnostics !== null && !healthy)) ? (
            <IconAlert size={24} weight="duotone" />
          ) : (
            <IconShieldCheck size={24} weight="duotone" />
          )}
        </span>
        <div className="engine-health-body">
          <div className="engine-health-title">
            <h2>
              {restful
                ? "The auction is over — nothing is running"
                : unreachable
                  ? "We can't reach the engine"
                  : diagnostics === null
                    ? "Checking the engine…"
                    : healthy
                      ? "The engine is healthy"
                      : "The engine needs attention"}
            </h2>
            {/* The title already says "can't reach"; a red badge repeating it
                was the page shouting twice (round 2). */}
            {unreachable ? null : diagnostics !== null ? (
              <Badge tone={healthy ? "success" : "danger"} data-testid="engine-health">
                {healthy ? "healthy" : "attention required"}
              </Badge>
            ) : null}
          </div>
          {diagnostics?.halted != null ? (
            <p className="competitions-hint diag-fail" data-testid="engine-halted">
              HALTED FAIL-CLOSED: {diagnostics.halted}
            </p>
          ) : (
            <p className="competitions-hint">
              {diagnostics !== null
                ? `${String(diagnostics.eventCount)} events on the record, every one verified · ${String(diagnostics.connectedClients)} ${diagnostics.connectedClients === 1 ? "screen" : "screens"} connected${refreshMs !== null ? " · checked just now" : ""}.`
                : restful
                  ? "The engine only runs while a room is live. Every sale and bid is in the ledger, and the replay steps through them."
                  : unreachable
                    ? "The engine isn't answering. The live room stays read-only until it does; this page checks again on its own."
                    : "Reading the engine's own account of the room…"}
            </p>
          )}
          {restful ? null : (
            <p className="engine-health-explain">
              {finished
                ? "The auction is over, so there is nothing to recover."
                : "If the room ever looks stuck, Recover rebuilds it from the record. The room pauses for a few seconds."}
            </p>
          )}
        </div>
        <div className="engine-health-actions">
          {finished ? (
            <>
              <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="secondary" size="sm">
                <IconList size={16} />
                Ledger
              </ButtonLink>
              <ButtonLink href={`/seasons/${slug}/auction/replay`} variant="ghost" size="sm">
                <IconPlay size={16} />
                Replay
              </ButtonLink>
            </>
          ) : null}
          {finished ? null : (
            <Button
              variant="secondary"
              size="sm"
              // One click used to pause a live room with no warning. It asks first.
              onClick={() => {
                setConfirmOpen(true);
              }}
              loading={busy}
              disabled={finished}
              data-testid="engine-recover"
            >
              <IconRefresh size={16} />
              Recover engine
            </Button>
          )}
          {finished ? null : (
            <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="ghost" size="sm">
              <IconGavel size={16} />
              Cockpit
            </ButtonLink>
          )}
        </div>
      </Card>

      {/* What the record says, from the page's own read — so the page is
          never one sentence over a blank canvas while the engine is quiet. */}
      {record !== undefined ? (
        <dl className="engine-facts" data-testid="engine-record">
          <div>
            <dt>Auction</dt>
            <dd>{STATUS_WORD[status ?? record.status] ?? status ?? record.status}</dd>
          </div>
          <div>
            <dt>Events on the record</dt>
            <dd>{(diagnostics?.eventCount ?? record.events).toLocaleString("en-IN")}</dd>
          </div>
          <div>
            <dt>Lots</dt>
            <dd>{record.lots.toLocaleString("en-IN")}</dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>
              {diagnostics !== null
                ? healthy
                  ? "Answering"
                  : "Needs attention"
                : unreachable
                  ? restful
                    ? "Idle"
                    : "Not answering"
                  : "Checking…"}
            </dd>
          </div>
        </dl>
      ) : null}

      {diagnostics !== null ? (
        <details className="engine-details">
          <summary>
            Technical diagnostics
            <span className="engine-details-hint">replay, queue, hashes, watchdog</span>
          </summary>
          <div className="engine-details-body">
            <section data-testid="recovery-dashboard" className="engine-group">
              <h3>Recovery</h3>
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
                  label="Recoveries"
                  value={String(diagnostics.recoveries)}
                  testId="diag-recoveries"
                />
              </div>
            </section>
            <section className="engine-group">
              <h3>Integrity</h3>
              <div className="diag-grid">
                <Tile
                  label="Recovery status"
                  value={diagnostics.halted === null ? "verified" : "halted"}
                  tone={diagnostics.halted === null ? "ok" : "fail"}
                  testId="diag-recovery-status"
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
                  label="Watchdog"
                  value={diagnostics.watchdog.stalled ? "stalled" : "ticking"}
                  tone={diagnostics.watchdog.stalled ? "fail" : "ok"}
                  testId="diag-watchdog"
                />
              </div>
              <dl className="engine-hashes" data-testid="diagnostics-card">
                <div>
                  <dt>Snapshot hash</dt>
                  <dd className="diag-hash" data-testid="diag-snapshot-hash">
                    {diagnostics.snapshotHash.slice(0, 16)}…
                  </dd>
                </div>
                <div>
                  <dt>Projection hash</dt>
                  <dd className="diag-hash" data-testid="diag-projection-hash">
                    {diagnostics.projectionHash.slice(0, 16)}…
                  </dd>
                </div>
              </dl>
            </section>
            <section className="engine-group">
              <h3>Throughput</h3>
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
                <Tile
                  label="Avg processing"
                  value={ms(diagnostics.avgProcessMs)}
                  testId="diag-avg"
                />
                <Tile
                  label="Max processing"
                  value={ms(diagnostics.maxProcessMs)}
                  testId="diag-max"
                />
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
                  label="Diagnostics refresh"
                  value={refreshMs !== null ? ms(refreshMs) : "—"}
                  testId="diag-refresh"
                />
              </div>
            </section>
          </div>
        </details>
      ) : null}
      <Dialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
        }}
        title="Recover the engine?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void recover()} data-testid="engine-recover-confirm">
              Recover engine
            </Button>
          </>
        }
      >
        <p>
          Rebuild this auction from its event log? The room pauses for a few seconds while it
          replays.
        </p>
      </Dialog>
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
