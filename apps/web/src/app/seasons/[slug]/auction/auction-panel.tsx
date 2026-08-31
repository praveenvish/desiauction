"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast, Field, ButtonLink } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  auctionLifecycleAction,
  createAuctionAction,
  issuePaddleAction,
  queueAllLotsAction,
  releasePaddleAction,
  verifyReplayAction,
  type AuctionDashboard,
  type ReplayVerifyReport,
} from "../../../../server/auction/actions";
import {
  squadFeasibility,
  type AuctionSetupFieldErrors,
} from "../../../../server/auction/auction-setup";
import { formatTime } from "../../../../lib/format-date";
import { AbortDialog } from "./abort-dialog";
import { ConnectionCheck, RulesCard } from "./live-experience";

// The auction desk: readiness gates, creation, lifecycle, paddles, the lot
// queue and the replay proof. The operational dashboard above it is rendered by
// AuctionOverviewPanel; the live bidding surfaces are /live and /cockpit.

const AUCTION_TONE = {
  scheduled: "info",
  live: "success",
  paused: "warning",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "danger",
} as const;

const LOT_TONE = {
  prepared: "neutral",
  queued: "info",
  on_block: "success",
  closing_soon: "warning",
  sold: "success",
  unsold: "neutral",
  frozen: "warning",
  withdrawn: "danger",
} as const;

// One legal next step per status, rendered one gate at a time.
const AUCTION_NEXT: Partial<Record<string, { command: string; label: string }[]>> = {
  scheduled: [{ command: "open", label: "Open auction" }],
  live: [
    { command: "pause", label: "Pause" },
    { command: "complete", label: "Close auction" },
  ],
  paused: [
    { command: "resume", label: "Resume" },
    { command: "complete", label: "Close auction" },
  ],
};

export function AuctionPanel({ slug, dashboard }: { slug: string; dashboard: AuctionDashboard }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // DA-05: pre-filled with the values every auction used to get unconditionally.
  const [purse, setPurse] = useState("20000000");
  const [squadMin, setSquadMin] = useState("8");
  const [squadMax, setSquadMax] = useState("15");
  const [timer, setTimer] = useState("30");
  const [extension, setExtension] = useState("15");
  const [baseDefault, setBaseDefault] = useState("10000");
  const [bands, setBands] = useState<Record<string, string>>({
    A: "50000",
    B: "25000",
    C: "10000",
  });
  const [paddleTeam, setPaddleTeam] = useState("");
  const [report, setReport] = useState<ReplayVerifyReport | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // The config locks at creation, so a refusal has to say which field is wrong
  // rather than quietly substituting a value the organizer never chose.
  const [fieldErrors, setFieldErrors] = useState<AuctionSetupFieldErrors>({});
  const [acceptShortSquads, setAcceptShortSquads] = useState(false);
  const [acceptShortOpen, setAcceptShortOpen] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const { ready, view, viewer } = dashboard;

  // The same sum the server will do, run against whatever is typed right now.
  const unplacedPool = ready.pool.filter((entry) => entry.teamId === null).length;
  const typedFeasibility = squadFeasibility({
    poolSize: unplacedPool,
    squadSizes: ready.squadSizes,
    squadMin: /^\d+$/.test(squadMin.trim()) ? Number(squadMin) : dashboard.feasibility.squadMin,
    squadMax: /^\d+$/.test(squadMax.trim()) ? Number(squadMax) : dashboard.feasibility.squadMax,
  });
  const liveFeasibility = view === null ? typedFeasibility : dashboard.feasibility;

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.ok) {
      if (done !== undefined) {
        toast({ title: done, tone: "success" });
      }
      router.refresh();
    } else {
      toast({ title: result.error ?? "Refused.", tone: "danger" });
    }
  };

  const verify = async () => {
    setBusy(true);
    const result = await verifyReplayAction(slug);
    setBusy(false);
    if (result.ok && result.report !== undefined) {
      setReport(result.report);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Replay failed.", tone: "danger" });
    }
  };

  return (
    <div
      className="competitions-stack"
      data-testid="auction-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      {dashboard.rules !== null ? <RulesCard rules={dashboard.rules} /> : null}
      {dashboard.wsUrl !== null ? <ConnectionCheck wsUrl={dashboard.wsUrl} /> : null}

      <Card data-testid="ready-panel">
        <h2>Ready to open</h2>
        <p className="competitions-hint">
          Every gate that has to be green before the auction can open.
        </p>
        <ul className="conflict-list">
          {ready.checks.map((check) => (
            <li key={check.id} data-testid={`check-${check.id}`}>
              <Badge tone={check.pass ? "success" : "danger"}>{check.pass ? "pass" : "fail"}</Badge>
              <span>{check.label}</span>
              <span className="registration-phone">{check.detail}</span>
            </li>
          ))}
          {/* Not one of the gates: a shortfall does not stop an auction being
              created, it stops one being CLOSED. It is stated here because
              this is where an organizer decides the squad minimum. */}
          <li data-testid="check-squads_fillable">
            <Badge tone={liveFeasibility.ok ? "success" : "warning"}>
              {liveFeasibility.ok ? "fits" : "short"}
            </Badge>
            <span>Pool against squads</span>
            <span className="registration-phone">{liveFeasibility.headline}</span>
          </li>
          <li>
            <Badge tone="neutral">info</Badge>
            <span>
              Auction pool {ready.pool.length} · Teams {ready.teams.length} · Fixtures{" "}
              {ready.scheduledFixtures} · Code {ready.competitionCode}
            </span>
          </li>
        </ul>
        {/*
            An abandoned auction is a season with no auction, not a season that
            can never hold one: `createAuction` allows a replacement "unless the
            previous one was abandoned" (packages/auction/src/aggregate.ts).
            Gating this form on `view === null` alone contradicted that — an
            abort left the organiser with no way back, and because intake cannot
            be reopened either, the season was finished. The abort dialog says
            THIS auction can never go live again; it is not a promise that the
            season is over.
        */}
        {(view === null || view.auction.status === "abandoned") && viewer.canConduct ? (
          <div className="auction-setup" data-testid="auction-setup">
            {/* DA-05: these are the numbers a league negotiates, and until now
                every auction took ₹2 Cr purses, 8–15 squads and three fixed
                bands because the config was a constant. Pre-filled with those
                same defaults, so an organiser who does not care still clicks
                one button. */}
            <p className="competitions-hint">
              Rules of the night — these lock when the auction is created. Nothing here is guessed
              for you: a value that isn&apos;t a whole number is refused, not replaced.
            </p>
            <div className="date-row">
              <Field
                label="Purse per team (₹)"
                name="pursePerTeam"
                inputMode="numeric"
                value={purse}
                error={fieldErrors["pursePerTeam"]}
                onChange={(event) => {
                  setPurse(event.target.value);
                }}
              />
              <Field
                label="Squad minimum"
                name="squadMin"
                inputMode="numeric"
                value={squadMin}
                error={fieldErrors["squadMin"]}
                onChange={(event) => {
                  setSquadMin(event.target.value);
                }}
              />
              <Field
                label="Squad maximum"
                name="squadMax"
                inputMode="numeric"
                value={squadMax}
                error={fieldErrors["squadMax"]}
                onChange={(event) => {
                  setSquadMax(event.target.value);
                }}
              />
            </div>
            <div className="date-row">
              <Field
                label="Lot timer (seconds)"
                name="timerSeconds"
                inputMode="numeric"
                value={timer}
                error={fieldErrors["timerSeconds"]}
                onChange={(event) => {
                  setTimer(event.target.value);
                }}
              />
              <Field
                label="Anti-snipe extension (seconds)"
                name="extensionSeconds"
                inputMode="numeric"
                value={extension}
                error={fieldErrors["extensionSeconds"]}
                onChange={(event) => {
                  setExtension(event.target.value);
                }}
              />
              <Field
                label="Default base price (₹)"
                name="basePriceDefault"
                inputMode="numeric"
                value={baseDefault}
                error={fieldErrors["basePriceDefault"]}
                onChange={(event) => {
                  setBaseDefault(event.target.value);
                }}
              />
            </div>
            <div className="date-row">
              {(["A", "B", "C"] as const).map((label) => (
                <Field
                  key={label}
                  label={`Band ${label} base price (₹)`}
                  name={`band${label}`}
                  inputMode="numeric"
                  value={bands[label]}
                  error={fieldErrors[`band${label}`]}
                  help="Clear the field to drop this band."
                  onChange={(event) => {
                    setBands({ ...bands, [label]: event.target.value });
                  }}
                />
              ))}
            </div>
            {/* The arithmetic, before the room exists. */}
            <p
              className={typedFeasibility.ok ? "competitions-hint" : "auction-feasibility is-short"}
              data-testid="feasibility-preview"
            >
              {typedFeasibility.headline}
              {typedFeasibility.note !== null ? ` ${typedFeasibility.note}` : ""}
            </p>
            {!typedFeasibility.ok ? (
              <label className="auction-ack">
                <input
                  type="checkbox"
                  checked={acceptShortSquads}
                  data-testid="accept-short-squads"
                  onChange={(event) => {
                    setAcceptShortSquads(event.target.checked);
                  }}
                />
                <span>
                  Create anyway — I accept that {typedFeasibility.shortfall} squad place
                  {typedFeasibility.shortfall === 1 ? "" : "s"} cannot be filled, and that closing
                  short needs the conductor&apos;s override on the cockpit.
                </span>
              </label>
            ) : null}
            <Button
              size="touch"
              onClick={() =>
                void act(async () => {
                  const result = await createAuctionAction(slug, {
                    pursePerTeam: purse,
                    squadMin,
                    squadMax,
                    timerSeconds: timer,
                    extensionSeconds: extension,
                    basePriceDefault: baseDefault,
                    bands,
                    acceptShortSquads,
                  });
                  setFieldErrors(result.fieldErrors ?? {});
                  return result;
                }, "Auction created")
              }
              loading={busy}
              disabled={!ready.ok}
              data-testid="create-auction"
            >
              Create auction
            </Button>
          </div>
        ) : null}
      </Card>

      {view !== null ? (
        <>
          <Card data-testid="auction-lifecycle">
            <div className="competition-head">
              <h2>{view.auction.name}</h2>
              <Badge tone={AUCTION_TONE[view.auction.status]} data-testid="auction-status">
                {view.auction.status}
              </Badge>
            </div>
            <p className="competitions-hint">
              {/* DA-30: purse is money sight. Absent from the payload, not
                  dimmed in the markup, for anyone without it. */}
              {view.auction.config.pursePerTeam !== undefined
                ? `Purse ${formatPaiseINR(paise(view.auction.config.pursePerTeam))} · `
                : ""}
              squad {view.auction.config.squadMin}–{view.auction.config.squadMax} · timer{" "}
              {view.auction.config.timer.initialSeconds}s +{" "}
              {view.auction.config.timer.extensionSeconds}s anti-snipe · config locked at creation
            </p>
            {/* The shortfall follows the auction all the way to its close —
                stated here every time the page is opened, not discovered at
                11pm behind a refusal. */}
            {!liveFeasibility.ok ? (
              <p className="auction-feasibility is-short" data-testid="feasibility-banner">
                {liveFeasibility.headline} Closing this auction will need the conductor&apos;s
                override on the cockpit (Close auction → “Close short — on the record”).
              </p>
            ) : null}
            {viewer.canConduct ? (
              <div className="date-row">
                {(AUCTION_NEXT[view.auction.status] ?? []).map((step) =>
                  // DO NOT OFFER WHAT THIS SCREEN CANNOT DO.
                  //
                  // Closing an auction whose squads are short needs a REASON on
                  // the record (DA-06), and the place that asks for one is the
                  // cockpit's two-act dialog. This panel has no such dialog, and
                  // its Close passed no override at all — so for a short auction
                  // the button could only ever produce a refusal. The refusal
                  // was at least well-written (it names the cockpit and the
                  // exact control), but a button whose only outcome is an error
                  // is a worse thing to put in front of a conductor at 11pm than
                  // a link to where the work happens.
                  step.command === "complete" && !liveFeasibility.ok ? (
                    <ButtonLink
                      key={step.command}
                      href={`/seasons/${slug}/auction/cockpit`}
                      variant="secondary"
                      size="touch"
                      data-testid="auction-complete-on-cockpit"
                    >
                      Close short — on the cockpit
                    </ButtonLink>
                  ) : (
                    <Button
                      key={step.command}
                      size="touch"
                      onClick={() =>
                        void act(
                          () =>
                            auctionLifecycleAction(slug, step.command, undefined, {
                              acceptShortSquads: acceptShortOpen,
                            }),
                          step.label,
                        )
                      }
                      loading={busy}
                      data-testid={`auction-${step.command}`}
                    >
                      {step.label}
                    </Button>
                  ),
                )}
                {view.auction.status !== "completed" &&
                view.auction.status !== "reconciled" &&
                view.auction.status !== "abandoned" ? (
                  /* Behind a confirmation now. This is the catastrophic exit —
                     `abandoned` is terminal and there is no command back — and
                     it used to be a single tap beside Pause, with the reason
                     hardcoded to "conductor abort" so the log never said why. */
                  <AbortDialog
                    busy={busy}
                    onAbort={(reason) => {
                      void act(
                        () => auctionLifecycleAction(slug, "abort", reason),
                        "Auction aborted",
                      );
                    }}
                  />
                ) : null}
              </div>
            ) : null}
            {viewer.canConduct && view.auction.status === "scheduled" && !liveFeasibility.ok ? (
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
                  Open anyway — {liveFeasibility.shortfall} squad place
                  {liveFeasibility.shortfall === 1 ? "" : "s"} cannot be filled from this pool.
                </span>
              </label>
            ) : null}
          </Card>

          <Card data-testid="paddles-panel">
            <h2>Paddles</h2>
            {/* THE PADDLE TRAP, stated before auction night instead of
                discovered in the hall: "Issue paddle" hands the paddle to
                WHOEVER CLICKS IT, one browser can hold one paddle, and opening
                needs two teams able to bid. An organizer who clicks twice ends
                up holding both paddles and cannot run the room. */}
            <p className="competitions-hint">
              One paddle per team. Issuing gives the paddle to <strong>you</strong> — the person
              clicking — so bidding needs each team&apos;s owner on their own device. Invite team
              owners from the{" "}
              <a href={`/seasons/${slug}/teams`} className="auction-inline-link">
                Teams tab
              </a>{" "}
              (or the{" "}
              <a href={`/seasons/${slug}/auction/cockpit`} className="auction-inline-link">
                cockpit
              </a>
              ), and they claim their own paddle. Release hands one back.
            </p>
            {view.paddles.length === 0 ? (
              <p className="competitions-hint">No paddles issued yet.</p>
            ) : (
              <ul className="conflict-list">
                {view.paddles.map((paddle) => {
                  // The overview lists ACTIVE paddles only (released ones are
                  // filtered at the read), which is how a released paddle is
                  // told apart from a live one here.
                  const active =
                    dashboard.overview === null ||
                    dashboard.overview.paddles.some(
                      (row) => row.paddleNumber === paddle.paddleNumber,
                    );
                  return (
                    <li key={paddle.id} data-testid={`paddle-${paddle.paddleNumber}`}>
                      <Badge tone={active ? "info" : "neutral"}>{paddle.paddleNumber}</Badge>
                      <span className="registration-name">{paddle.teamName}</span>
                      <span className="registration-phone">
                        {active ? (paddle.holderName ?? "—") : "released"}
                        {paddle.committed !== undefined
                          ? ` · committed ${formatPaiseINR(paise(paddle.committed))}`
                          : ""}{" "}
                        · squad {paddle.squadSize}
                      </span>
                      {viewer.canConduct && active ? (
                        <Button
                          variant="ghost"
                          size="touch"
                          onClick={() =>
                            void act(
                              () => releasePaddleAction(slug, paddle.teamId),
                              "Paddle released",
                            )
                          }
                          loading={busy}
                          data-testid={`release-paddle-${paddle.paddleNumber}`}
                        >
                          Release
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {viewer.canConduct ? (
              <div className="date-row">
                <Select
                  label="Team"
                  name="paddleTeam"
                  value={paddleTeam}
                  onChange={(event) => {
                    setPaddleTeam(event.target.value);
                  }}
                >
                  <option value="">Choose…</option>
                  {ready.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="touch"
                  onClick={() =>
                    void act(() => issuePaddleAction(slug, paddleTeam), "Paddle issued")
                  }
                  loading={busy}
                  disabled={paddleTeam === ""}
                  data-testid="issue-paddle"
                >
                  Issue paddle
                </Button>
              </div>
            ) : null}
          </Card>

          <Card data-testid="lot-queue">
            <div className="competition-head">
              <h2>Lot queue</h2>
              <span className="competitions-hint">
                {view.lots.length} lots · registration-number order
              </span>
            </div>
            {viewer.canConduct ? (
              <div className="date-row">
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={() => void act(() => queueAllLotsAction(slug), "Lots queued")}
                  loading={busy}
                  data-testid="queue-all"
                >
                  Queue all prepared
                </Button>
              </div>
            ) : null}
            <div className="table-scroll">
              <table className="reg-table" data-testid="lots-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Role</th>
                    <th>Base</th>
                    <th>Status</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {view.lots.map((lot) => (
                    /* `.reg-table` drops its `thead` below 1100px and brings the
                       headings back through `data-label` (seasons.css). */
                    <tr key={lot.id} data-testid={`lot-${lot.lotNumber}`}>
                      <td data-label="#" className="reg-number">
                        {lot.lotNumber}
                      </td>
                      <td data-label="Player">{lot.playerName ?? "Unnamed"}</td>
                      <td data-label="Role">{lot.role.replace(/_/g, " ")}</td>
                      <td data-label="Base">{formatPaiseINR(paise(lot.basePrice))}</td>
                      <td data-label="Status">
                        <Badge tone={LOT_TONE[lot.status]}>{lot.status.replace(/_/g, " ")}</Badge>
                      </td>
                      <td data-label="Result">
                        {lot.soldPrice !== null
                          ? `${formatPaiseINR(paise(lot.soldPrice))} → ${lot.soldToPaddle ?? ""}`
                          : lot.bidCount > 0
                            ? `${String(lot.bidCount)} bid(s)`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                  {view.lots.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="dash-hint">
                        No lots.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          <Card data-testid="replay-panel">
            <div className="competition-head">
              <h2>Event log &amp; replay</h2>
              <span className="competitions-hint">
                {view.eventCount} immutable events · single-writer order
              </span>
            </div>
            {viewer.canConduct ? (
              <Button
                variant="secondary"
                size="touch"
                onClick={() => void verify()}
                loading={busy}
                data-testid="verify-replay"
              >
                Replay events &amp; verify state
              </Button>
            ) : null}
            {report !== null ? (
              <p data-testid="replay-report" className="competitions-hint">
                {report.ok
                  ? report.divergences === 0
                    ? `Replayed ${String(report.eventCount)} events — projection matches persisted state exactly.`
                    : `Replayed ${String(report.eventCount)} events — healed ${String(report.divergences)} divergence(s) from the log.`
                  : `Replay failed closed: ${report.reason ?? ""}`}
              </p>
            ) : null}
            <ol className="timeline">
              {view.events.map((event) => (
                <li key={event.seq}>
                  <Badge tone="neutral">#{event.seq}</Badge>
                  <span className="registration-name">{event.type}</span>
                  <span className="timeline-at">{formatTime(event.atMs)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      ) : null}
    </div>
  );
}
