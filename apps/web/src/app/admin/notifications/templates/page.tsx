import {
  EmptyState,
  IconClock,
  IconInfo,
  IconLock,
  IconMessageCircle,
  IconPhone,
  IconRefresh,
  Pill,
  SectionCard,
  ToastProvider,
} from "@desiauction/ui";
import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../../server/admin/authz";
import {
  adminProviderTemplates,
  type MappedView,
  type ProviderTemplatesView,
  type SmsRow,
  type StatusView,
  type WhatsAppRow,
} from "../../../../server/admin/provider-template-views";
import { RelativeTime } from "../../admin-ui";
import {
  ClearTemplate,
  MapTemplate,
  RefreshFromMeta,
  RevertTemplate,
  SubmitTemplate,
  UseApprovedName,
} from "./template-controls";
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
 * WHATSAPP AND SMS TEMPLATES (Notification Control Center, Phase 3).
 *
 * Which approved template each message goes out under, what Meta last said
 * about it, and a way to submit the catalogue's own wording for approval. The
 * wording itself is not editable here — Meta sends only what it approved.
 * Behind `platform.admin` and nothing new; a not-found for everyone else.
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
            Which Meta-approved template each message uses. A mapping here wins over the server
            setting; every change is audited.
          </p>

          <SyncCard view={view} />
          <OtpCard view={view} />
          <WhatsAppCard view={view} />
          <SmsCard view={view} />
          <RecentCard view={view} />
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

function SyncCard({ view }: { view: ProviderTemplatesView }) {
  return (
    <SectionCard
      icon={<IconRefresh />}
      tone="neutral"
      title="Meta status"
      description="What Meta last said about each template. Read on demand, and every six hours by the scheduled job."
      action={view.syncEnabled ? <RefreshFromMeta /> : undefined}
      data-testid="tpl-sync"
    >
      {view.syncEnabled ? (
        <p className="admin-meta" data-testid="tpl-sync-state">
          {view.sync.lastSuccessAt === null ? (
            "Not read from Meta yet."
          ) : (
            <>
              Last read <RelativeTime at={view.sync.lastSuccessAt} /> ·{" "}
              {String(view.sync.templateCount)} template
              {view.sync.templateCount === 1 ? "" : "s"} on the account
            </>
          )}
          {view.sync.lastError === null ? null : (
            <span className="ptpl-sync-error"> · Last try failed: {view.sync.lastError}</span>
          )}
        </p>
      ) : (
        // One quiet line, not a banner: the page had three stacked notices
        // saying "not set up" in three shades before the first row.
        <p className="ptpl-note" data-testid="tpl-sync-disabled">
          <IconInfo size={16} />
          <span>
            Status sync is off: set <code>WHATSAPP_BUSINESS_ACCOUNT_ID</code> (WhatsApp Manager →
            Account tools) with the WhatsApp access token to read Meta&rsquo;s approvals and to
            submit templates from here. Mapping names works without it.
          </span>
        </p>
      )}
    </SectionCard>
  );
}

function Statuses({ statuses, testId }: { statuses: readonly StatusView[]; testId: string }) {
  if (statuses.length === 0) {
    return (
      <span className="admin-zero ptpl-nostatus" data-testid={testId} title="No status from Meta">
        <span aria-hidden>—</span>
        <span className="admin-sr-only">No status from Meta</span>
      </span>
    );
  }
  return (
    <ul className="ptpl-statuses" data-testid={testId}>
      {statuses.map((s) => (
        <li key={s.language}>
          <Pill tone={s.tone} dot>
            {s.language}: {s.label}
          </Pill>
          {s.quality === null ? null : <span className="admin-meta"> Quality {s.quality}</span>}
          {s.submitted ? <span className="admin-meta"> · as submitted</span> : null}
          {s.rejectedReason === null ? null : (
            <span className="admin-meta ptpl-rejected"> Reason: {s.rejectedReason}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function OtpCard({ view }: { view: ProviderTemplatesView }) {
  return (
    <SectionCard
      icon={<IconLock />}
      tone="neutral"
      title="Sign-in code"
      description="Meta's authentication template. Set on the server only — whether anybody can sign in is never changed from a screen."
      data-testid="tpl-otp"
    >
      <div className="ptpl-row-head">
        <span className="admin-cell-main">
          <span className="admin-name">{view.otp.name ?? "Not set"}</span>
          <span className="admin-meta">
            WHATSAPP_TEMPLATE_NAME
            {view.otp.language === null ? "" : ` · language ${view.otp.language}`}
          </span>
        </span>
        <Pill tone="neutral" icon={<IconLock size={14} />}>
          Read-only
        </Pill>
      </div>
      <Statuses statuses={view.otp.statuses} testId="tpl-otp-status" />
    </SectionCard>
  );
}

function Mapped({ mapped, testId }: { mapped: MappedView; testId: string }) {
  const source = SOURCE[mapped.source];
  return (
    <span className="admin-cell-main">
      <span className="ptpl-row-head">
        {/* "None" beside "Not set" said one thing twice: with no template the
            state alone is drawn, and the name is announced as none. */}
        {mapped.handle === null ? (
          <span className="admin-sr-only" data-testid={testId}>
            None
          </span>
        ) : (
          <span className="admin-name ptpl-handle" data-testid={testId}>
            {mapped.handle}
          </span>
        )}
        <span
          className="admin-state"
          data-tone={SOURCE_DOT[mapped.source]}
          data-testid={`${testId}-source`}
        >
          <span className="admin-state-dot" aria-hidden />
          {source.label}
        </span>
      </span>
      {mapped.source === "admin" ? (
        <span className="admin-meta">
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
      <span
        className="admin-meta ptpl-env"
        title={`Server setting ${mapped.envVar}: ${mapped.envValue ?? "unset"}`}
      >
        <span className="admin-sr-only">Server setting </span>
        <code className="admin-env">{mapped.envVar}</code>
        {mapped.envValue === null ? (
          <span className="admin-sr-only">: unset</span>
        ) : (
          <span>: {mapped.envValue}</span>
        )}
      </span>
    </span>
  );
}

function WhatsAppKindRow({ row, view }: { row: WhatsAppRow; view: ProviderTemplatesView }) {
  const approval = row.approval;
  return (
    <li id={`tpl-${row.kind}`} data-testid={`tpl-wa-${row.kind}`} className="ptpl-row">
      <div className="ptpl-row-head">
        <span className="admin-cell-main">
          <span className="admin-name">{row.label}</span>
          <span className="admin-meta">{row.description}</span>
        </span>
      </div>
      <Mapped mapped={row.mapped} testId={`tpl-wa-name-${row.kind}`} />
      <Statuses statuses={row.statuses} testId={`tpl-wa-status-${row.kind}`} />
      {approval?.verdict === "not_approved" ? (
        <p className="admin-meta ptpl-warn" data-testid={`tpl-wa-warn-${row.kind}`}>
          Not sending on WhatsApp: {approval.why}.
        </p>
      ) : approval?.verdict === "approved" && approval.missing.length > 0 ? (
        <p className="admin-meta" data-testid={`tpl-wa-warn-${row.kind}`}>
          Not approved yet in {approval.missing.join(", ")} — those readers get English.
        </p>
      ) : null}
      <div className="ptpl-actions">
        <MapTemplate
          kind={row.kind}
          kindLabel={row.label}
          channel="whatsapp"
          current={row.mapped.handle}
          currentLanguages={row.mapped.languages}
          approvedNames={view.approvedNames}
          syncKnown={view.sync.lastSuccessAt !== null}
        />
        {row.mapped.source === "admin" ? (
          <ClearTemplate
            kind={row.kind}
            kindLabel={row.label}
            channel="whatsapp"
            fallback={row.mapped.envValue}
          />
        ) : null}
        {row.approvedCandidates.map((name) => (
          <UseApprovedName key={name} kind={row.kind} kindLabel={row.label} name={name} />
        ))}
        {view.syncEnabled && row.submitRefusal === null ? (
          <SubmitTemplate
            kind={row.kind}
            kindLabel={row.label}
            suggestedName={row.suggestedName}
            preview={row.preview}
          />
        ) : null}
      </div>
      {row.submitRefusal === null ? null : <p className="admin-meta">{row.submitRefusal}</p>}
    </li>
  );
}

function WhatsAppCard({ view }: { view: ProviderTemplatesView }) {
  return (
    <SectionCard
      icon={<IconMessageCircle />}
      tone="neutral"
      title="WhatsApp templates"
      description="One template name holds both languages. A reader gets their own language where it is approved, else English."
      flush
      data-testid="tpl-whatsapp"
    >
      {view.whatsappConfigured ? null : (
        <div className="ptpl-card-note">
          <p className="ptpl-note" data-testid="tpl-wa-unconfigured">
            <IconInfo size={16} />
            <span>
              WhatsApp is not set up on this server (no phone number ID or token), so nothing goes
              on WhatsApp whatever is mapped here.
            </span>
          </p>
        </div>
      )}
      <ul className="admin-rows ptpl-grid">
        {view.whatsapp.map((row) => (
          <WhatsAppKindRow key={row.kind} row={row} view={view} />
        ))}
      </ul>
    </SectionCard>
  );
}

function SmsKindRow({ row }: { row: SmsRow }) {
  return (
    <li id={`tpl-sms-${row.kind}`} data-testid={`tpl-sms-${row.kind}`} className="ptpl-row">
      <span className="admin-name">{row.label}</span>
      <Mapped mapped={row.mapped} testId={`tpl-sms-id-${row.kind}`} />
      <div className="ptpl-actions">
        <MapTemplate
          kind={row.kind}
          kindLabel={row.label}
          channel="sms"
          current={row.mapped.handle}
          currentLanguages={null}
          approvedNames={[]}
          syncKnown={false}
        />
        {row.mapped.source === "admin" ? (
          <ClearTemplate
            kind={row.kind}
            kindLabel={row.label}
            channel="sms"
            fallback={row.mapped.envValue}
          />
        ) : null}
      </div>
    </li>
  );
}

function SmsCard({ view }: { view: ProviderTemplatesView }) {
  return (
    <SectionCard
      icon={<IconPhone />}
      tone="neutral"
      title="SMS templates"
      description="The DLT template ID each SMS goes out against."
      flush
      data-testid="tpl-sms"
    >
      {view.smsGateway ? null : (
        <div className="ptpl-card-note">
          <p className="ptpl-note" data-testid="tpl-sms-dormant">
            <IconInfo size={16} />
            <span>
              SMS is dormant — DLT is not configured (no MSG91 key). IDs mapped here take effect
              once it is.
            </span>
          </p>
        </div>
      )}
      <ul className="admin-rows ptpl-grid">
        {view.sms.map((row) => (
          <SmsKindRow key={row.kind} row={row} />
        ))}
      </ul>
    </SectionCard>
  );
}

function RecentCard({ view }: { view: ProviderTemplatesView }) {
  return (
    <SectionCard
      icon={<IconClock />}
      tone="neutral"
      title="Recent changes"
      description="The last twenty mappings and submissions, newest first. Revert re-applies what a mapping replaced, and is itself recorded."
      flush
      data-testid="tpl-recent"
    >
      {view.recent.length === 0 ? (
        <div className="admin-card-empty">
          <EmptyState
            size="compact"
            headingLevel={3}
            title="Nothing changed yet"
            description="Every template still uses the server setting. Mappings and submissions appear here with who made them."
          />
        </div>
      ) : (
        <ul className="admin-rows">
          {view.recent.map((change) => (
            <li key={change.id} data-testid={`tpl-change-${change.id}`}>
              <span className="admin-cell-main">
                <span className="admin-name">{change.summary}</span>
                <span className="admin-meta">
                  {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
                  {change.revertOf === null ? null : " · a revert"}
                </span>
              </span>
              {change.revertable ? (
                <RevertTemplate auditId={change.id} summary={change.summary} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
