import {
  EmptyState,
  IconFileCheck,
  IconLock,
  IconMessageCircle,
  IconSend,
  Pill,
  SectionCard,
} from "@desiauction/ui";

import { formatCount, maskContact } from "../../../server/admin/format";
import type { MessagingOverview } from "../../../server/admin/views";
import { NavButton } from "../../players/nav-button";
import { RelativeTime, TableCount } from "../admin-ui";

/**
 * Can this deployment actually text anyone, and who must it never text?
 *
 * Two facts that lived only inside a process's environment and a table with no
 * reader. A shape whose registered DLT id is unset REFUSES to send — the right
 * behaviour, because sending against somebody else's registration is worse than
 * not sending — but the refusal was invisible, so a misconfigured deployment
 * looked identical to a working one until an organizer asked why nobody had
 * been told.
 *
 * The registered TEXT is shown in full: it is the sentence the gateway matches
 * character for character, so it is the thing worth auditing. The provider id
 * itself is never displayed — knowing it changes nothing, and it is a
 * credential-shaped value.
 */
export function MessagingPanel({ overview }: { overview: MessagingOverview }) {
  const allConfigured = overview.configured === overview.total;
  return (
    <>
      <SectionCard
        icon={<IconFileCheck />}
        tone={allConfigured ? "green" : "red"}
        title="Registered templates"
        description="DLT registration per message shape; open a row for its exact text"
        action={
          <Pill tone={allConfigured ? "green" : "red"} dot testId="admin-templates-verdict">
            {allConfigured
              ? `All ${String(overview.total)} configured`
              : `${String(overview.configured)} of ${String(overview.total)} configured`}
          </Pill>
        }
        flush
      >
        {allConfigured ? null : (
          <p className="admin-card-empty admin-warning" data-testid="admin-templates-warning">
            A shape with no registered id refuses to send and names the missing variable in the
            audit log. Those messages are not queued and not retried — they do not go out at all.
          </p>
        )}
        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="admin-template-table">
            <thead>
              <tr>
                <th scope="col">Message</th>
                <th scope="col">Status</th>
                <th scope="col">Environment variable</th>
              </tr>
            </thead>
            <tbody>
              {overview.templates.map((row) => (
                <tr key={row.key} data-testid={`admin-template-${row.key}`}>
                  <td data-label="Message">
                    <span className="admin-cell-main">
                      <span className="admin-name admin-mono-key">{row.key}</span>
                      {/* The registered sentence, verbatim — folded behind the
                          key. The gateway matches it character for character,
                          so it is kept whole, one click away. */}
                      <details className="admin-log-meta admin-tpl-body">
                        <summary>
                          <span className="admin-sr-only">Registered text: </span>
                          {row.channel} · {row.category} · {row.locale} · {row.body}
                        </summary>
                        <p className="admin-meta">{row.body}</p>
                      </details>
                    </span>
                  </td>
                  <td data-label="Status">
                    {/* The verdict pill in the card head already says how many;
                        a row says its own state as a dot and a word. */}
                    <span className="admin-state" data-tone={row.configured ? "green" : "red"}>
                      <span className="admin-state-dot" aria-hidden />
                      {row.configured ? "Registered" : "Missing"}
                    </span>
                  </td>
                  <td data-label="Environment variable" className="is-wide">
                    <code className="admin-env" title={row.variable}>
                      {row.variable}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        icon={<IconSend />}
        tone="neutral"
        title="Delivery by message"
        description={`Last ${String(overview.deliveryWindowDays)} days, counted from the sender's own audit rows`}
        flush
      >
        {overview.delivery.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="Nothing sent yet"
              description="Decision notices appear here once an organizer approves, waitlists or declines somebody."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" data-testid="admin-delivery-table">
              <thead>
                <tr>
                  <th scope="col">Message</th>
                  <th scope="col" className="admin-num">
                    Sent
                  </th>
                  <th scope="col" className="admin-num">
                    Failed
                  </th>
                  <th scope="col" className="admin-num">
                    Suppressed
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.delivery.map((row) => (
                  <tr key={row.template}>
                    <td data-label="Message">
                      <span className="admin-name admin-mono-key">{row.template}</span>
                    </td>
                    <td data-label="Sent" className="admin-count admin-num">
                      <TableCount n={row.sent} />
                    </td>
                    {/* Failed is a delivery problem. Suppressed is the gate
                        working — somebody said stop, or a club switched the
                        topic off. Folding them together would send an operator
                        chasing an outage that is not happening. */}
                    <td data-label="Failed" className="admin-count admin-num">
                      {row.failed === 0 ? (
                        <TableCount n={0} />
                      ) : (
                        <strong className="admin-bad">{formatCount(row.failed)}</strong>
                      )}
                    </td>
                    <td data-label="Suppressed" className="admin-count admin-num">
                      <TableCount n={row.suppressed} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={<IconMessageCircle />}
        tone={overview.whatsapp.failed > 0 ? "red" : "neutral"}
        title="WhatsApp delivery"
        description={`Last ${String(overview.deliveryWindowDays)} days, from Meta's callbacks. All "awaiting" and nothing delivered means the callback URL is not subscribed.`}
      >
        <div className="admin-chips" data-testid="admin-whatsapp-delivery">
          <Pill tone="neutral">
            awaiting <span className="admin-count">{String(overview.whatsapp.awaiting)}</span>
          </Pill>
          <Pill tone={overview.whatsapp.delivered > 0 ? "green" : "neutral"}>
            delivered <span className="admin-count">{String(overview.whatsapp.delivered)}</span>
          </Pill>
          <Pill tone={overview.whatsapp.read > 0 ? "green" : "neutral"}>
            read <span className="admin-count">{String(overview.whatsapp.read)}</span>
          </Pill>
          <Pill tone={overview.whatsapp.failed > 0 ? "red" : "neutral"}>
            failed <span className="admin-count">{String(overview.whatsapp.failed)}</span>
          </Pill>
          {/* A STOP is somebody's choice, not a fault, and is toned as such. */}
          <Pill tone="neutral">
            STOP replies <span className="admin-count">{String(overview.whatsapp.stops)}</span>
          </Pill>
        </div>
      </SectionCard>

      {/* No lift button here, still. This surface is read-only; lifting and
          adding by hand live on the suppression desk (Notification Control
          Center, Phase 4), one contact at a time, audited — the link below. */}
      <SectionCard
        icon={<IconLock />}
        tone="neutral"
        title="Suppression list"
        description={
          <>
            <span className="admin-count" data-testid="admin-suppression-count">
              {String(overview.liveSuppressions)}
            </span>{" "}
            contacts we must not send to · newest {String(Math.min(5, overview.recent.length))}{" "}
            shown
          </>
        }
        action={
          <NavButton href="/admin/notifications/suppressions" variant="ghost">
            Manage all
            <span className="admin-sr-only"> suppressions</span>
          </NavButton>
        }
        flush
      >
        {/* Bounces and complaints carry consequences beyond the one person:
            continuing to send to a hard bounce is how a sending domain dies,
            and a complaint is somebody telling their provider we are spam. A
            STOP is simply somebody's choice, and is toned as such. */}
        {overview.byReason.length > 0 ? (
          <div className="admin-chips admin-card-empty" data-testid="admin-suppression-reasons">
            {overview.byReason.map((row) => (
              <Pill
                key={`${row.channel}:${row.reason}`}
                tone={row.reason === "bounce" || row.reason === "complaint" ? "red" : "neutral"}
              >
                {row.channel} {row.reason} <span className="admin-count">{String(row.count)}</span>
              </Pill>
            ))}
          </div>
        ) : null}
        {overview.recent.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="Nobody is suppressed"
              description="Numbers that text STOP, and addresses that bounce or complain, appear here."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" data-testid="admin-suppression-table">
              <thead>
                <tr>
                  <th scope="col">Contact</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Topic</th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                {/* The newest five; the desk owns the whole list. */}
                {overview.recent.slice(0, 5).map((row) => (
                  <tr key={`${row.channel}:${row.contact}:${row.createdAt.toISOString()}`}>
                    {/* Masked, like every other contact on this surface.
                        Administration needs to see THAT a contact is
                        suppressed and why; it does not need the contact. */}
                    <td data-label="Contact">
                      <span className="admin-cell-main">
                        <span className="admin-name" data-private>
                          {maskContact(row.contact)}
                        </span>
                        <span className="admin-meta">{row.channel}</span>
                      </span>
                    </td>
                    <td data-label="Reason">
                      <span
                        className="admin-state"
                        data-tone={
                          row.reason === "bounce" || row.reason === "complaint" ? "red" : undefined
                        }
                      >
                        <span className="admin-state-dot" aria-hidden />
                        {row.reason}
                      </span>
                    </td>
                    <td data-label="Topic">{row.scope}</td>
                    <td data-label="Since">
                      <RelativeTime at={row.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
