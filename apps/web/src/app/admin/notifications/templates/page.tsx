import {
  EmptyState,
  IconArrowLeft,
  IconClock,
  IconInfo,
  IconLock,
  IconMessageCircle,
  IconPhone,
  IconRefresh,
  Notice,
  Pill,
  SectionCard,
  ToastProvider,
  type KitTone,
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
import { NavButton } from "../../../players/nav-button";
import { RelativeTime } from "../../admin-ui";
import {
  ClearTemplate,
  MapTemplate,
  RefreshFromMeta,
  RevertTemplate,
  SubmitTemplate,
  UseApprovedName,
} from "./template-controls";
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
          <header className="dash-head tpl-page-head">
            {/* NavButton, not buttonClassName(): a server component. */}
            <NavButton href="/admin/notifications" variant="ghost" className="tpl-back">
              <IconArrowLeft size={18} aria-hidden />
              All notifications
            </NavButton>
            <p className="dash-hint">
              WhatsApp sends only templates Meta has approved, by name. Here you choose which
              approved name each message uses, see Meta&rsquo;s verdict on it, and submit our
              wording for approval. A mapping here wins over the server setting; clearing it goes
              back to the server setting. Every change is on the audit log and can be reverted.
            </p>
          </header>

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

const SOURCE: Record<MappedView["source"], { label: string; tone: KitTone }> = {
  admin: { label: "Mapped here", tone: "blue" },
  env: { label: "Server setting", tone: "neutral" },
  unset: { label: "Not set", tone: "amber" },
};

function SyncCard({ view }: { view: ProviderTemplatesView }) {
  return (
    <SectionCard
      icon={<IconRefresh />}
      tone="blue"
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
        <Notice tone="info" icon={<IconInfo size={20} />} testId="tpl-sync-disabled">
          Status sync is off: set <code>WHATSAPP_BUSINESS_ACCOUNT_ID</code> (WhatsApp Manager →
          Account tools) with the WhatsApp access token to read Meta&rsquo;s approvals and to submit
          templates from here. Mapping names works without it; the status column stays empty.
        </Notice>
      )}
    </SectionCard>
  );
}

function Statuses({ statuses, testId }: { statuses: readonly StatusView[]; testId: string }) {
  if (statuses.length === 0) {
    return (
      <span className="admin-meta" data-testid={testId}>
        No status from Meta
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
        <span className="admin-name ptpl-handle" data-testid={testId}>
          {mapped.handle ?? "None"}
        </span>
        <Pill tone={source.tone} testId={`${testId}-source`}>
          {source.label}
        </Pill>
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
      <span className="admin-meta">
        Server setting {mapped.envVar}: {mapped.envValue ?? "unset"}
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
      tone="green"
      title="WhatsApp templates"
      description="One template name holds both languages. A reader gets their own language where it is approved, else English."
      flush
      data-testid="tpl-whatsapp"
    >
      {view.whatsappConfigured ? null : (
        <div className="ptpl-card-note">
          <Notice tone="info" icon={<IconInfo size={20} />} testId="tpl-wa-unconfigured">
            WhatsApp is not set up on this server (no phone number ID or token), so nothing goes on
            WhatsApp whatever is mapped here.
          </Notice>
        </div>
      )}
      <ul className="admin-rows is-stacked">
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
          <Notice tone="warning" icon={<IconInfo size={20} />} testId="tpl-sms-dormant">
            SMS is dormant — DLT is not configured (no MSG91 key). IDs mapped here take effect once
            it is.
          </Notice>
        </div>
      )}
      <ul className="admin-rows is-stacked">
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
            headingLevel={3}
            title="Nothing changed yet"
            description="Every template still uses the server setting. Mappings and submissions appear here with who made them."
          />
        </div>
      ) : (
        <ul className="admin-rows is-stacked">
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
