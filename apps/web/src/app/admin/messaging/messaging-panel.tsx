import { Badge, Card, EmptyState } from "@desiauction/ui";

import { maskContact } from "../../../server/admin/format";
import type { MessagingOverview } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

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
      <ReadOnlyNotice />

      <section aria-labelledby="admin-templates">
        <h2 className="admin-section-title" id="admin-templates">
          Registered templates
        </h2>
        <Card>
          <div className="admin-health-row">
            <span>DLT registration</span>
            <Badge
              tone={allConfigured ? "success" : "danger"}
              data-testid="admin-templates-verdict"
            >
              {allConfigured
                ? `All ${String(overview.total)} configured`
                : `${String(overview.configured)} of ${String(overview.total)} configured`}
            </Badge>
          </div>
          {allConfigured ? null : (
            <p className="admin-meta" data-testid="admin-templates-warning">
              A shape with no registered id refuses to send and names the missing variable in the
              audit log. Those messages are not queued and not retried — they do not go out at all.
            </p>
          )}
          <div className="table-scroll">
            <table className="reg-table" data-testid="admin-template-table">
              <thead>
                <tr>
                  <th scope="col">Message</th>
                  <th scope="col">Status</th>
                  <th scope="col">Environment variable</th>
                </tr>
              </thead>
              <tbody>
                {overview.templates.map((row) => (
                  <tr key={row.key} className="reg-row" data-testid={`admin-template-${row.key}`}>
                    <td data-label="Message">
                      <span className="registration-name">{row.key}</span>
                      <span className="admin-meta">
                        {row.channel} · {row.category} · {row.locale}
                      </span>
                      {/* The registered sentence, verbatim. The gateway matches
                          it character for character — a template whose text has
                          drifted from its registration is rejected at the
                          provider, not here. */}
                      <span className="admin-meta">{row.body}</span>
                    </td>
                    <td data-label="Status">
                      <Badge tone={row.configured ? "success" : "danger"}>
                        {row.configured ? "Registered" : "Missing"}
                      </Badge>
                    </td>
                    <td data-label="Environment variable">
                      <code className="admin-meta">{row.variable}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section aria-labelledby="admin-suppressions">
        <h2 className="admin-section-title" id="admin-suppressions">
          Suppression list
        </h2>
        <Card>
          {/* No lift button, deliberately. Somebody who texts START lifts their
              own; the day support genuinely needs to lift somebody else's is a
              conversation at review, not an import into a read-only surface. */}
          <div className="admin-health-row">
            <span>Contacts we must not send to</span>
            <Badge tone="neutral" data-testid="admin-suppression-count">
              {String(overview.liveSuppressions)}
            </Badge>
          </div>
          {/* Bounces and complaints carry consequences beyond the one person:
              continuing to send to a hard bounce is how a sending domain dies,
              and a complaint is somebody telling their provider we are spam. A
              STOP is simply somebody's choice, and is toned as such. */}
          <div className="admin-chips" data-testid="admin-suppression-reasons">
            {overview.byReason.map((row) => (
              <Badge
                key={`${row.channel}:${row.reason}`}
                tone={row.reason === "bounce" || row.reason === "complaint" ? "danger" : "neutral"}
              >
                {row.channel} {row.reason} <span className="admin-count">{String(row.count)}</span>
              </Badge>
            ))}
          </div>
          {overview.recent.length === 0 ? (
            <EmptyState
              title="Nobody is suppressed"
              description="Numbers that text STOP, and addresses that bounce or complain, appear here."
            />
          ) : (
            <div className="table-scroll">
              <table className="reg-table" data-testid="admin-suppression-table">
                <thead>
                  <tr>
                    <th scope="col">Contact</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Topic</th>
                    <th scope="col">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recent.map((row) => (
                    <tr
                      key={`${row.channel}:${row.contact}:${row.createdAt.toISOString()}`}
                      className="reg-row"
                    >
                      {/* Masked, like every other contact on this surface.
                          Administration needs to see THAT a contact is
                          suppressed and why; it does not need the contact. */}
                      <td data-label="Contact">
                        <span className="registration-name">{maskContact(row.contact)}</span>
                        <span className="admin-meta">{row.channel}</span>
                      </td>
                      <td data-label="Reason">{row.reason}</td>
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
        </Card>
      </section>
    </>
  );
}
