import type { SmsRoute } from "../../../../server/messaging/delivery-readiness";
import { EmptyState, IconInfo, IconLock, Notice, Pill, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { platformAdminPageGate } from "../../../../server/admin/authz";
import {
  adminProviderTemplates,
  type MappedView,
  type ProviderTemplatesView,
  type SmsRow,
  type StatusView,
  type WhatsAppRow,
} from "../../../../server/admin/provider-template-views";
import { RecentFold, RelativeTime } from "../../admin-ui";
import {
  CopyEnvName,
  MapTemplate,
  RefreshFromMeta,
  RevertTemplate,
  TemplateRowMenu,
  UseApprovedName,
} from "./template-controls";
import {
  clearLabel,
  mappedCount,
  setupLines,
  setupTitle,
  smsStatus,
  whatsappStatus,
  type SetupLine,
  type TemplateStatus,
} from "./templates-model";
import { AdminPageHead } from "../../admin-ui";
import { NotifySubnav } from "../notify-subnav";
import "../../../seasons/seasons.css";
import "../../admin.css";
import "../notifications.css";
import "./templates.css";

export const metadata = {
  title: "WhatsApp and SMS templates · Notifications · Platform admin · DesiAuction",
};

/**
 * WHATSAPP AND SMS TEMPLATES (Notification Control Center, Phase 3; redesign
 * stage 2, 2026-09-27).
 *
 * Which approved template each message goes out under, what Meta last said
 * about it, and a way to submit the catalogue's own wording for approval. The
 * wording itself is not editable here — Meta sends only what it approved.
 * Behind `platform.admin` and nothing new; a not-found for everyone else.
 *
 * Laid out like Messages: one calm banner for what is not set up on this
 * server, a list per channel with each message's state in a word and its
 * doors at the row's end (Map, and a ⋯ for the rarer ones), recent changes
 * in the side column.
 *
 * Rendered whole, no Suspense (the Phase 1 lesson): every section here is
 * changed by its own actions, and a streamed boundary kept showing the view
 * from before the change after `router.refresh()`.
 */
export default async function ProviderTemplatesPage() {
  if ((await platformAdminPageGate("notifications", "templates")) === null) {
    notFound();
  }
  const view = await adminProviderTemplates();
  if (view === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            <NotifySubnav current="templates" />
          </AdminPageHead>
          <p className="admin-lede admin-lede-under">
            Which approved template each WhatsApp and SMS message goes out under. A mapping here
            wins over the server setting; every change is audited.
          </p>

          <SetupBanner view={view} />
          <div className="msg-layout ptpl-layout">
            <div className="msg-list">
              <WhatsAppList view={view} />
              <SmsList view={view} />
            </div>
            <div className="msg-side">
              <RecentCard view={view} />
            </div>
          </div>
        </div>
      </main>
    </ToastProvider>
  );
}

const SOURCE_DOT: Record<MappedView["source"], string | undefined> = {
  admin: "green",
  env: undefined,
  unset: undefined,
};

const SOURCE: Record<MappedView["source"], { label: string }> = {
  admin: { label: "Mapped here" },
  env: { label: "Server setting" },
  unset: { label: "Not set" },
};

/* ── What is not set up, said once ─────────────────────────────────────── */

/** The SMS line is drawn only when there is no gateway; this says which kind. */
function smsRouteOff(view: ProviderTemplatesView): Exclude<SmsRoute, "gateway"> {
  return view.smsRoute === "dev_inbox" ? "dev_inbox" : "none";
}

/** Where a text goes when there is no gateway, in the page's words. */
const SMS_LINE: Record<Exclude<SmsRoute, "gateway">, ReactNode> = {
  dev_inbox: (
    <>
      SMS goes to the development inbox on this server — no gateway is set up. DLT IDs mapped here
      take effect once <code>MSG91_AUTH_KEY</code> is.
    </>
  ),
  none: (
    <>
      SMS is not set up on this server (no <code>MSG91_AUTH_KEY</code>): no text goes out, whatever
      is mapped here.
    </>
  ),
};

const SETUP_LINE: Record<Exclude<SetupLine["key"], "sms">, ReactNode> = {
  whatsapp: (
    <>
      WhatsApp is not set up on this server (no phone number ID or token): nothing goes on WhatsApp
      yet, whatever is mapped here.
    </>
  ),
  sync: (
    <>
      Status sync is off: set <code>WHATSAPP_BUSINESS_ACCOUNT_ID</code> to read Meta&rsquo;s
      approvals and submit templates from here. Mapping names works without it.
    </>
  ),
};

/**
 * One banner for everything the server lacks. The page used to say "not set
 * up" three times in three shades before the first row; each fact is still
 * here, as one line of one notice.
 */
function SetupBanner({ view }: { view: ProviderTemplatesView }) {
  const lines = setupLines(view);
  const title = setupTitle(view);
  if (lines.length === 0 || title === null) return null;
  return (
    <Notice tone="info" icon={<IconInfo size={20} />} title={title} testId="tpl-setup">
      <ul className="ptpl-setup">
        {lines.map((line) => (
          <li key={line.key} data-testid={line.testId}>
            {line.key === "sms" ? SMS_LINE[smsRouteOff(view)] : SETUP_LINE[line.key]}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/* ── A row ─────────────────────────────────────────────────────────────── */

function StatusWord({ status, testId }: { status: TemplateStatus; testId: string }) {
  return (
    <span className="ptpl-status">
      <Pill tone={status.tone} dot testId={testId}>
        {status.word}
      </Pill>
    </span>
  );
}

function Statuses({ statuses, testId }: { statuses: readonly StatusView[]; testId: string }) {
  if (statuses.length === 0) {
    return (
      <span className="admin-sr-only" data-testid={testId}>
        No status from Meta
      </span>
    );
  }
  return (
    <ul className="ptpl-statuses" data-testid={testId}>
      {statuses.map((s) => (
        <li key={s.language}>
          <span className="ntc-state" data-tone={s.tone}>
            <span className="ntc-dot" aria-hidden />
            {s.language}: {s.label}
          </span>
          {s.quality === null ? null : <span> · Quality {s.quality}</span>}
          {s.submitted ? <span> · as submitted</span> : null}
          {s.rejectedReason === null ? null : (
            <span className="ptpl-rejected"> · Reason: {s.rejectedReason}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The template a row uses, where it comes from, and the server setting under it. */
function Mapped({ mapped, testId }: { mapped: MappedView; testId: string }) {
  const source = SOURCE[mapped.source];
  return (
    <span className="ptpl-mapped">
      <span className="ptpl-mapped-line">
        {/* With no template the state alone is drawn, and the name is
            announced as none. */}
        {mapped.handle === null ? (
          <span className="admin-sr-only" data-testid={testId}>
            None
          </span>
        ) : (
          <span className="ptpl-handle" data-testid={testId}>
            {mapped.handle}
          </span>
        )}
        {/* "Not set" is the row's state word already; said once. */}
        <span
          className={mapped.source === "unset" ? "admin-sr-only" : "admin-state ptpl-source"}
          data-tone={SOURCE_DOT[mapped.source]}
          data-testid={`${testId}-source`}
        >
          <span className="admin-state-dot" aria-hidden />
          {source.label}
        </span>
      </span>
      {mapped.source === "admin" ? (
        <span className="ptpl-meta">
          {mapped.languages === null ? null : `Approved in ${mapped.languages.join(", ")} · `}
          {mapped.updatedByName ?? "An operator"}
          {mapped.updatedAt === null ? null : (
            <>
              {" · "}
              <RelativeTime at={mapped.updatedAt} />
            </>
          )}
          {mapped.note === null ? null : ` · ${mapped.note}`}
        </span>
      ) : null}
      {/* Only the name gives way on a narrow row; the copy button and the
          value (or "not set") always show. */}
      <span className="ptpl-meta ptpl-env">
        <span className="ptpl-env-label">Server setting</span>
        <code title={mapped.envVar}>{mapped.envVar}</code>
        <CopyEnvName name={mapped.envVar} />
        <span className="ptpl-env-value">
          {mapped.envValue === null ? "not set" : mapped.envValue}
        </span>
      </span>
    </span>
  );
}

function WhatsAppKindRow({ row, view }: { row: WhatsAppRow; view: ProviderTemplatesView }) {
  const approval = row.approval;
  return (
    <li id={`tpl-${row.kind}`} data-testid={`tpl-wa-${row.kind}`} className="ptpl-row">
      <span className="ptpl-kind">
        <span className="ptpl-kind-name">{row.label}</span>
        <span className="ptpl-kind-desc">{row.description}</span>
      </span>
      <StatusWord status={whatsappStatus(row)} testId={`tpl-wa-state-${row.kind}`} />
      <span className="ptpl-what">
        <Mapped mapped={row.mapped} testId={`tpl-wa-name-${row.kind}`} />
        <Statuses statuses={row.statuses} testId={`tpl-wa-status-${row.kind}`} />
      </span>
      <span className="ptpl-actions">
        {row.approvedCandidates.map((name) => (
          <UseApprovedName key={name} kind={row.kind} kindLabel={row.label} name={name} />
        ))}
        <MapTemplate
          kind={row.kind}
          kindLabel={row.label}
          channel="whatsapp"
          current={row.mapped.handle}
          currentLanguages={row.mapped.languages}
          approvedNames={view.approvedNames}
          syncKnown={view.sync.lastSuccessAt !== null}
        />
        <TemplateRowMenu
          kind={row.kind}
          kindLabel={row.label}
          channel="whatsapp"
          clear={row.mapped.source === "admin" ? clearLabel(row.mapped) : null}
          submit={
            view.syncEnabled && row.submitRefusal === null
              ? { suggestedName: row.suggestedName, preview: row.preview }
              : null
          }
        />
      </span>
      {approval?.verdict === "not_approved" ? (
        <p className="ptpl-note-line ptpl-warn" data-testid={`tpl-wa-warn-${row.kind}`}>
          Not sending on WhatsApp: {approval.why}.
        </p>
      ) : approval?.verdict === "approved" && approval.missing.length > 0 ? (
        <p className="ptpl-note-line" data-testid={`tpl-wa-warn-${row.kind}`}>
          Not approved yet in {approval.missing.join(", ")} — those readers get English.
        </p>
      ) : null}
      {row.submitRefusal === null ? null : <p className="ptpl-note-line">{row.submitRefusal}</p>}
    </li>
  );
}

/** Meta's authentication template: shown, never changed from a screen. */
function OtpRow({ view }: { view: ProviderTemplatesView }) {
  return (
    <li className="ptpl-row" data-testid="tpl-otp">
      <span className="ptpl-kind">
        <span className="ptpl-kind-name">Sign-in code</span>
        <span className="ptpl-kind-desc">
          Meta&rsquo;s authentication template. Set on the server only — whether anybody can sign in
          is never changed from a screen.
        </span>
      </span>
      <StatusWord
        status={
          view.otp.name === null
            ? { word: "Not set", tone: "neutral" }
            : {
                word: "Set on server",
                tone: "blue",
              }
        }
        testId="tpl-otp-state"
      />
      <span className="ptpl-what">
        <span className="ptpl-mapped">
          {view.otp.name === null ? null : <span className="ptpl-handle">{view.otp.name}</span>}
          <span className="ptpl-meta ptpl-env">
            <code>WHATSAPP_TEMPLATE_NAME</code>
            {view.otp.language === null ? "" : ` · language ${view.otp.language}`}
          </span>
        </span>
        <Statuses statuses={view.otp.statuses} testId="tpl-otp-status" />
      </span>
      <span className="ptpl-actions">
        <Pill tone="neutral" icon={<IconLock size={14} />}>
          Read-only
        </Pill>
      </span>
    </li>
  );
}

function ListHead({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: string;
  children?: ReactNode;
}) {
  return (
    <header className="msg-group-head ptpl-head">
      <span className="ptpl-head-text">
        <h2 id={id}>{title}</h2>
        <span>{count}</span>
      </span>
      {children}
    </header>
  );
}

function SyncState({ view }: { view: ProviderTemplatesView }) {
  if (!view.syncEnabled) return null;
  return (
    <span className="ptpl-sync" data-testid="tpl-sync">
      <span className="ptpl-sync-text" data-testid="tpl-sync-state">
        {view.sync.lastSuccessAt === null ? (
          "Not read from Meta yet"
        ) : (
          <>
            Meta read <RelativeTime at={view.sync.lastSuccessAt} /> ·{" "}
            {String(view.sync.templateCount)} template
            {view.sync.templateCount === 1 ? "" : "s"}
          </>
        )}
        {view.sync.lastError === null ? null : (
          <span className="ptpl-sync-error"> · Last try failed: {view.sync.lastError}</span>
        )}
      </span>
      <RefreshFromMeta />
    </span>
  );
}

function WhatsAppList({ view }: { view: ProviderTemplatesView }) {
  return (
    <section className="msg-card" aria-labelledby="tpl-whatsapp-title" data-testid="tpl-whatsapp">
      <ListHead id="tpl-whatsapp-title" title="WhatsApp" count={mappedCount(view.whatsapp)}>
        <SyncState view={view} />
      </ListHead>
      <p className="ptpl-lede">
        One template name holds both languages. A reader gets their own language where it is
        approved, else English.
      </p>
      <ul className="ptpl-rows">
        <OtpRow view={view} />
        {view.whatsapp.map((row) => (
          <WhatsAppKindRow key={row.kind} row={row} view={view} />
        ))}
      </ul>
    </section>
  );
}

function SmsKindRow({ row }: { row: SmsRow }) {
  return (
    <li id={`tpl-sms-${row.kind}`} data-testid={`tpl-sms-${row.kind}`} className="ptpl-row">
      <span className="ptpl-kind">
        <span className="ptpl-kind-name">{row.label}</span>
      </span>
      <StatusWord status={smsStatus(row)} testId={`tpl-sms-state-${row.kind}`} />
      <span className="ptpl-what">
        <Mapped mapped={row.mapped} testId={`tpl-sms-id-${row.kind}`} />
      </span>
      {/* The words DLT registered — what the ID in this row stands for. */}
      <p className="ptpl-note-line ptpl-sms-text" data-testid={`tpl-sms-text-${row.kind}`}>
        {row.text}
      </p>
      <span className="ptpl-actions">
        <MapTemplate
          kind={row.kind}
          kindLabel={row.label}
          channel="sms"
          current={row.mapped.handle}
          currentLanguages={null}
          approvedNames={[]}
          syncKnown={false}
        />
        <TemplateRowMenu
          kind={row.kind}
          kindLabel={row.label}
          channel="sms"
          clear={row.mapped.source === "admin" ? clearLabel(row.mapped) : null}
          submit={null}
        />
      </span>
    </li>
  );
}

function SmsList({ view }: { view: ProviderTemplatesView }) {
  return (
    <section className="msg-card" aria-labelledby="tpl-sms-title" data-testid="tpl-sms">
      <ListHead id="tpl-sms-title" title="SMS" count={mappedCount(view.sms)} />
      <p className="ptpl-lede">The DLT template ID each SMS goes out against.</p>
      <ul className="ptpl-rows">
        {view.sms.map((row) => (
          <SmsKindRow key={row.kind} row={row} />
        ))}
      </ul>
    </section>
  );
}

/* ── Recent changes ────────────────────────────────────────────────────── */

function RecentCard({ view }: { view: ProviderTemplatesView }) {
  return (
    <section
      className="msg-card msg-recent"
      aria-labelledby="tpl-recent-title"
      data-testid="tpl-recent"
    >
      <header className="msg-recent-head">
        <h2 id="tpl-recent-title">Recent changes</h2>
        <span>Mappings and submissions, newest first · a revert is recorded too</span>
      </header>
      {view.recent.length === 0 ? (
        <EmptyState
          size="compact"
          headingLevel={3}
          title="Nothing changed yet"
          description="Every template still uses the server setting. Mappings and submissions appear here with who made them."
        />
      ) : (
        <RecentFold items={view.recent} className="msg-recent-list">
          {(change) => (
            <li key={change.id} data-testid={`tpl-change-${change.id}`}>
              <span className="msg-recent-dot" aria-hidden />
              <span className="msg-recent-text">
                <span className="msg-change-line">{change.summary}</span>
                <span className="msg-change-meta">
                  {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
                  {change.revertOf === null ? null : " · a revert"}
                </span>
              </span>
              {change.revertable ? (
                <RevertTemplate auditId={change.id} summary={change.summary} />
              ) : null}
            </li>
          )}
        </RecentFold>
      )}
    </section>
  );
}
