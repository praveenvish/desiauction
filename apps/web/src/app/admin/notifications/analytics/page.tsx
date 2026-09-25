import {
  EmptyState,
  IconAlert,
  SegmentedTabs,
  IconBroadcast,
  IconChart,
  IconClock,
  Pill,
  SectionCard,
} from "@desiauction/ui";
import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../../server/admin/authz";
import { ANALYTICS_WINDOWS, parseWindow, rate } from "../../../../server/admin/delivery-analytics";
import {
  adminDeliveryAnalytics,
  istDay,
  type AnalyticsChannel,
  type ReasonRow,
} from "../../../../server/admin/delivery-analytics-views";
import { TrendChart } from "./trend-chart";
import { AdminPageHead } from "../../admin-ui";
import { NotifySubnav } from "../notify-subnav";
import "../../../seasons/seasons.css";
import "../../admin.css";
import "../notifications.css";

export const metadata = {
  title: "Delivery analytics · Notifications · Platform admin · DesiAuction",
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

const STATUS_LABEL: Record<ReasonRow["status"], { label: string; tone: "red" | "amber" }> = {
  failed: { label: "Failed", tone: "red" },
  suppressed: { label: "Suppressed", tone: "amber" },
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
          Queued messages by channel and kind, and why the ones that did not go did not. Sign-in
          codes, receipts and security emails are not counted. Days are India time.
        </p>

        <SectionCard
          icon={<IconBroadcast />}
          tone="blue"
          title="By channel"
          description={`The last ${String(windowDays)} days, from ${istDay(view.since)}, India time.`}
          flush
          data-testid="analytics-channels"
        >
          <div className="dla-figures">
            {view.channels.map((c) => {
              const settled = c.sent + c.failed;
              return (
                <section
                  key={c.channel}
                  className="dla-channel"
                  aria-labelledby={`analytics-channel-${c.channel}`}
                  data-testid={`analytics-channel-${c.channel}`}
                >
                  <h3 id={`analytics-channel-${c.channel}`} className="admin-name">
                    {CHANNEL_LABEL[c.channel]}
                  </h3>
                  <dl>
                    <dt>Sent</dt>
                    <dd data-testid={`analytics-${c.channel}-sent`}>{String(c.sent)}</dd>
                    <dt>Suppressed</dt>
                    <dd data-testid={`analytics-${c.channel}-suppressed`}>
                      {String(c.suppressed)}
                    </dd>
                    <dt>Failed</dt>
                    <dd data-testid={`analytics-${c.channel}-failed`}>{String(c.failed)}</dd>
                    {c.pending > 0 ? (
                      <>
                        <dt>Still queued</dt>
                        <dd>{String(c.pending)}</dd>
                      </>
                    ) : null}
                    <dt>Failure rate</dt>
                    <dd>{rate(c.failed, settled)}</dd>
                    {c.channel === "whatsapp" ? (
                      <>
                        <dt>Delivered</dt>
                        <dd data-testid="analytics-whatsapp-delivered">
                          {rate(c.delivered, c.sent)}
                        </dd>
                        <dt>Read</dt>
                        <dd data-testid="analytics-whatsapp-read">{rate(c.read, c.sent)}</dd>
                      </>
                    ) : null}
                  </dl>
                </section>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          icon={<IconClock />}
          tone="neutral"
          title="By day"
          description="Queued messages each day, by how they ended."
          flush
        >
          <TrendChart days={view.daily} windowDays={windowDays} />
        </SectionCard>

        <SectionCard
          icon={<IconAlert />}
          tone="neutral"
          title="Why messages did not go"
          description="The most common reasons, grouped. Never the recipient or the message."
          flush
          data-testid="analytics-reasons"
        >
          {view.reasons.length === 0 ? (
            <div className="admin-card-empty">
              <EmptyState
                headingLevel={3}
                title="Nothing failed or was suppressed"
                description={`In the last ${String(windowDays)} days every queued message that settled was sent.`}
              />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Reason</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Channels</th>
                    <th scope="col">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {view.reasons.map((r) => (
                    <tr key={`${r.status}|${r.label}`} data-testid={`analytics-reason-${r.label}`}>
                      <td data-label="Reason">
                        <span className="dla-code">{r.label}</span>
                      </td>
                      <td data-label="Outcome">
                        <Pill tone={STATUS_LABEL[r.status].tone}>
                          {STATUS_LABEL[r.status].label}
                        </Pill>
                      </td>
                      <td data-label="Channels">
                        {r.channels.map((c) => CHANNEL_LABEL[c]).join(", ")}
                      </td>
                      <td data-label="Count" className="admin-count admin-num">
                        {String(r.count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={<IconChart />}
          tone="neutral"
          title="By kind"
          description="Each message kind on each channel, busiest first."
          flush
          data-testid="analytics-kinds"
        >
          {!anything ? (
            <div className="admin-card-empty">
              <EmptyState
                headingLevel={3}
                title="Nothing queued"
                description={`No message went through the queue in the last ${String(windowDays)} days.`}
              />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Channel</th>
                    <th scope="col">Sent</th>
                    <th scope="col">Suppressed</th>
                    <th scope="col">Failed</th>
                    <th scope="col">Failure rate</th>
                  </tr>
                </thead>
                <tbody>
                  {view.kinds.map((k) => (
                    <tr
                      key={`${k.kind}|${k.channel}`}
                      data-testid={`analytics-kind-${k.kind}-${k.channel}`}
                    >
                      <td data-label="Kind">
                        <span className="admin-name">{k.label}</span>
                      </td>
                      <td data-label="Channel">{CHANNEL_LABEL[k.channel]}</td>
                      <td data-label="Sent" className="admin-num">
                        {String(k.sent)}
                      </td>
                      <td data-label="Suppressed" className="admin-num">
                        {String(k.suppressed)}
                      </td>
                      <td data-label="Failed" className="admin-num">
                        {String(k.failed)}
                      </td>
                      <td data-label="Failure rate" className="admin-num">
                        {rate(k.failed, k.sent + k.failed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
