import {
  EmptyState,
  IconMail,
  IconSms,
  IconTile,
  IconWhatsApp,
  Pill,
  SegmentedTabs,
} from "@desiauction/ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { platformAdminPageGate } from "../../../../server/admin/authz";
import { ANALYTICS_WINDOWS, parseWindow, rate } from "../../../../server/admin/delivery-analytics";
import {
  adminDeliveryAnalytics,
  istDay,
  type AnalyticsChannel,
  type ReasonRow,
} from "../../../../server/admin/delivery-analytics-views";
import { TrendChart } from "./trend-chart";
import {
  cellWords,
  channelSentence,
  headlineFigures,
  kindMatrix,
  leadFinding,
  totalsOf,
} from "./analytics-model";
import { AdminPageHead, humanAction, KpiValue } from "../../admin-ui";
import { formatCount } from "../../../../server/admin/format";
import { NotifySubnav } from "../notify-subnav";
import "../../../seasons/seasons.css";
import "../../admin.css";
import "../notifications.css";
import "./analytics.css";

export const metadata = {
  title: "Delivery analytics · Notifications · Platform admin",
};

/**
 * DELIVERY ANALYTICS (Notification Control Center, Phase 4).
 *
 * How the queued messages of the last 7, 30 or 90 days went: per channel, per
 * kind, the reasons they did not go, and a day-by-day trend. Counts only —
 * never a recipient, an address or a message (see delivery-analytics-views.ts).
 * Behind `platform.admin`; a not-found for everyone else.
 *
 * The window is a URL search param (?days=7|30|90), clamped on the server, so a
 * view can be linked to and a stale or hand-typed link cannot ask for more than
 * ninety days.
 */

const CHANNEL_LABEL: Record<AnalyticsChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

const ANALYTICS_CHANNEL_ORDER: readonly AnalyticsChannel[] = ["email", "whatsapp", "sms"];

const CHANNEL_ICON: Record<AnalyticsChannel, ReactNode> = {
  email: <IconMail />,
  whatsapp: <IconWhatsApp />,
  sms: <IconSms />,
};

const STATUS_LABEL: Record<ReasonRow["status"], { label: string; tone: "red" | "amber" }> = {
  failed: { label: "Failed", tone: "red" },
  suppressed: { label: "Held back", tone: "amber" },
  undelivered: { label: "Not delivered", tone: "red" },
};

export default async function AdminDeliveryAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await platformAdminPageGate("delivery-analytics")) === null) {
    notFound();
  }
  const windowDays = parseWindow((await searchParams)["days"]);
  const view = await adminDeliveryAnalytics(windowDays);
  if (view === null) {
    notFound();
  }
  const anything = view.channels.some((c) => c.sent + c.failed + c.suppressed + c.pending > 0);
  const totals = totalsOf(view.channels);
  const figures = headlineFigures(totals, windowDays);
  const finding = leadFinding(totals, view.reasons, humanAction, (c) =>
    c in CHANNEL_LABEL ? CHANNEL_LABEL[c as AnalyticsChannel] : c,
  );
  const messages = kindMatrix(view.kinds);
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <AdminPageHead
          actions={
            <SegmentedTabs
              label="Time window"
              testId="analytics-windows"
              items={ANALYTICS_WINDOWS.map((days) => ({
                key: String(days),
                label: `Last ${String(days)} days`,
                href: `/admin/notifications/analytics?days=${String(days)}`,
                active: days === windowDays,
              }))}
            />
          }
        >
          <NotifySubnav current="analytics" />
        </AdminPageHead>
        <p className="admin-lede admin-lede-under">
          How queued messages went, by channel and kind, and why the ones that did not go did not.
          Sign-in codes, receipts and security emails are not counted. Days are India time.
        </p>

        {/* THE FINDING LEADS. "5,942 of 11,266 never went — every one for No
            verified email" was a small side card beside the chart; it is the
            first thing the page says now, over the four figures. */}
        <section
          className="msg-card dla-headline"
          aria-label="In total"
          data-testid="analytics-headline"
          data-tone={finding?.tone}
        >
          {finding === null ? null : (
            <div className="dla-finding" data-testid="analytics-finding">
              <h2>{finding.title}</h2>
              <p>{finding.body}</p>
            </div>
          )}
          <dl className="dla-figs">
            {figures.map((figure) => (
              <div key={figure.key} className="dla-fig" data-alarm={figure.alarm || undefined}>
                <dt>{figure.label}</dt>
                <dd className="dla-fig-value">
                  <KpiValue n={figure.value} />
                </dd>
                <dd className="dla-fig-hint">{figure.hint}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          className="msg-card"
          aria-labelledby="dla-channels-title"
          data-testid="analytics-channels"
        >
          <header className="msg-group-head">
            <h2 id="dla-channels-title">By channel</h2>
            <span>
              Last {String(windowDays)} days, from {istDay(view.since)}
            </span>
          </header>
          <div className="dla-figures">
            {view.channels.map((c) => {
              const settled = c.sent + c.failed;
              const quiet = c.sent + c.failed + c.suppressed + c.pending === 0;
              return (
                <section
                  key={c.channel}
                  className="dla-channel"
                  aria-labelledby={`analytics-channel-${c.channel}`}
                  data-testid={`analytics-channel-${c.channel}`}
                >
                  <h3 id={`analytics-channel-${c.channel}`} className="dla-channel-name">
                    <IconTile icon={CHANNEL_ICON[c.channel]} tone="neutral" size="sm" />
                    {CHANNEL_LABEL[c.channel]}
                  </h3>
                  {/* The channel in one sentence; the figures stay under it,
                      folded, for the one who needs the rate. A quiet channel
                      was a grid of 0 · 0 · 0 · — · — · —. */}
                  <p className="dla-channel-line" data-quiet={quiet || undefined}>
                    {channelSentence(
                      c,
                      CHANNEL_LABEL[c.channel],
                      windowDays,
                      c.channel === "sms" && view.smsRoute === "dev_inbox",
                    )}
                  </p>
                  {c.channel === "sms" && view.smsRoute === "dev_inbox" && !quiet ? (
                    <p className="dla-channel-note">No SMS gateway is set up on this server.</p>
                  ) : null}
                  <dl data-quiet={quiet || undefined}>
                    <dt className="dla-sr">Sent</dt>
                    <dd
                      className="dla-sr"
                      data-testid={`analytics-${c.channel}-sent`}
                      data-zero={zero(c.sent)}
                    >
                      {formatCount(c.sent)}
                    </dd>
                    <dt className="dla-sr">Held back</dt>
                    <dd
                      className="dla-sr"
                      data-testid={`analytics-${c.channel}-suppressed`}
                      data-zero={zero(c.suppressed)}
                    >
                      {formatCount(c.suppressed)}
                    </dd>
                    <dt className="dla-sr">Failed</dt>
                    <dd
                      className="dla-sr"
                      data-testid={`analytics-${c.channel}-failed`}
                      data-zero={zero(c.failed)}
                    >
                      {formatCount(c.failed)}
                    </dd>
                    {c.pending > 0 ? (
                      <>
                        <dt>Still queued</dt>
                        <dd>{String(c.pending)}</dd>
                      </>
                    ) : null}
                    <dt>Failure rate</dt>
                    <dd data-zero={settled === 0 || undefined}>{rate(c.failed, settled)}</dd>
                    {c.channel === "whatsapp" ? (
                      <>
                        <dt>Delivered</dt>
                        <dd data-testid="analytics-whatsapp-delivered" data-zero={zero(c.sent)}>
                          {rate(c.delivered, c.sent)}
                        </dd>
                        <dt>Read</dt>
                        <dd data-testid="analytics-whatsapp-read" data-zero={zero(c.sent)}>
                          {rate(c.read, c.sent)}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </section>
              );
            })}
          </div>
        </section>

        {/* The trend and its reasons side by side on a laptop: what happened
            each day, and why what did not go did not. */}
        <div className="dla-pair">
          <section className="msg-card" aria-labelledby="dla-trend-title">
            <header className="msg-group-head">
              <h2 id="dla-trend-title">By day</h2>
              <span>Queued each day, by how it ended</span>
            </header>
            <TrendChart days={view.daily} windowDays={windowDays} />
          </section>

          <section
            className="msg-card"
            aria-labelledby="dla-reasons-title"
            data-testid="analytics-reasons"
          >
            <header className="msg-group-head">
              <h2 id="dla-reasons-title">Why messages did not go</h2>
              <span>Grouped · never who or what</span>
            </header>
            {view.reasons.length === 0 ? (
              <div className="dla-empty">
                <EmptyState
                  size="compact"
                  headingLevel={3}
                  title="Nothing failed or was suppressed"
                  description={`In the last ${String(windowDays)} days every queued message that settled was sent.`}
                />
              </div>
            ) : (
              <ul className="dla-reasons">
                {view.reasons.map((r) => (
                  <li key={`${r.status}|${r.label}`} data-testid={`analytics-reason-${r.label}`}>
                    <span className="dla-reason-main">
                      <span className="dla-reason-name" title={r.label}>
                        {humanAction(r.label)}
                      </span>
                      <span className="dla-reason-meta">
                        <Pill tone={STATUS_LABEL[r.status].tone}>
                          {STATUS_LABEL[r.status].label}
                        </Pill>
                        <span>{r.channels.map((c) => CHANNEL_LABEL[c]).join(", ")}</span>
                      </span>
                    </span>
                    <span className="dla-reason-count">{formatCount(r.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section
          className="msg-card"
          aria-labelledby="dla-kinds-title"
          data-testid="analytics-kinds"
        >
          <header className="msg-group-head">
            <h2 id="dla-kinds-title">By message</h2>
            <span>Busiest first · one row a message, a column a channel</span>
          </header>
          {!anything ? (
            <div className="dla-empty">
              <EmptyState
                size="compact"
                headingLevel={3}
                title="Nothing queued"
                description={`No message went through the queue in the last ${String(windowDays)} days.`}
              />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table dla-table dla-matrix">
                <thead>
                  <tr>
                    <th scope="col">Message</th>
                    {ANALYTICS_CHANNEL_ORDER.map((c) => (
                      <th scope="col" key={c}>
                        {CHANNEL_LABEL[c]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.kind} data-testid={`analytics-kind-${m.kind}`}>
                      <td data-label="Message">
                        <span className="admin-name">{m.label}</span>
                      </td>
                      {ANALYTICS_CHANNEL_ORDER.map((c) => {
                        const cell = m.cells[c];
                        const words = cellWords(cell);
                        return (
                          <td
                            key={c}
                            data-label={CHANNEL_LABEL[c]}
                            data-testid={`analytics-kind-${m.kind}-${c}`}
                            data-held={cell !== undefined && cell.suppressed > 0 ? "" : undefined}
                            data-failed={cell !== undefined && cell.failed > 0 ? "" : undefined}
                            // A phone row leaves a channel with nothing out of its line.
                            data-empty={words === null || undefined}
                            className="dla-matrix-cell"
                          >
                            {words ?? (
                              <span className="admin-dash">
                                —<span className="admin-sr-only">Nothing</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/** A zero is the calm answer: drawn muted. */
function zero(n: number): true | undefined {
  return n === 0 || undefined;
}
