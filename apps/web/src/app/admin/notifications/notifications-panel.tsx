import {
  EmptyState,
  IconBell,
  IconBroadcast,
  IconClock,
  IconLock,
  Pill,
  SectionCard,
  type KitTone,
} from "@desiauction/ui";

import type {
  CellCounts,
  GridCell,
  GridRow,
  NotificationCenter,
} from "../../../server/admin/notification-views";
import type { WordingSummary } from "../../../server/admin/template-views";
import { NavButton } from "../../players/nav-button";
import { RelativeTime } from "../admin-ui";
import { ChannelControl, ControlToggle, RevertButton, SwitchToggle } from "./notification-controls";

/**
 * The control center, rendered on the server. Three parts, top to bottom, in
 * the order an operator reaches for them during an incident: the channel kill
 * switches, the grid of every kind on every channel, and what was changed
 * recently (with a way back).
 *
 * The grid is a list of cards, not a table: a kind is sent on one to four
 * channels, and at 360px four toggle columns would scroll sideways. Each
 * channel cell wraps on its own.
 */

const CATEGORY: Record<GridRow["category"], { label: string; tone: KitTone }> = {
  login: { label: "Sign-in", tone: "neutral" },
  security: { label: "Security", tone: "red" },
  transactional: { label: "Transactional", tone: "blue" },
  operational: { label: "Our team", tone: "purple" },
  promotional: { label: "Promotional", tone: "amber" },
};

function StateChip({ row, cell }: { row: GridRow; cell: GridCell }) {
  const testId = `notify-state-${row.key}-${cell.channel}`;
  switch (cell.state) {
    case "locked":
      return (
        <Pill tone="neutral" icon={<IconLock size={14} />} testId={testId}>
          Locked
        </Pill>
      );
    case "channel_off":
      return (
        <Pill tone="amber" dot testId={testId}>
          Channel off
        </Pill>
      );
    case "admin_off":
      return (
        <Pill tone="red" dot testId={testId}>
          Off by admin
        </Pill>
      );
    case "on":
      return cell.notConfigured === null ? (
        <Pill tone="green" dot testId={testId}>
          On
        </Pill>
      ) : (
        <Pill tone="amber" dot testId={testId}>
          Not configured
        </Pill>
      );
  }
}

function Counts({ counts, channel, days }: { counts: CellCounts; channel: string; days: number }) {
  const parts = [
    `${String(counts.sent)} sent`,
    `${String(counts.failed)} failed`,
    `${String(counts.suppressed)} suppressed`,
  ];
  if (channel === "whatsapp") {
    parts.push(`${String(counts.delivered)} delivered`, `${String(counts.read)} read`);
  }
  return (
    <span className="admin-meta">
      <span className="admin-sr-only">Last {String(days)} days: </span>
      {parts.join(" · ")}
    </span>
  );
}

function Cell({ row, cell, days }: { row: GridRow; cell: GridCell; days: number }) {
  return (
    <li className="ntc-cell" data-state={cell.state}>
      <div className="ntc-cell-head">
        {row.locked ? (
          <span className="ntc-locked-label">{cell.channelLabel}</span>
        ) : (
          <SwitchToggle
            kind={row.key}
            kindLabel={row.label}
            channel={cell.channel}
            channelLabel={cell.channelLabel}
            enabled={cell.kindEnabled}
            needsReason={row.needsReason}
          />
        )}
        <StateChip row={row} cell={cell} />
      </div>
      {cell.notConfigured === null ? null : (
        <span className="admin-meta ntc-note" data-testid={`notify-why-${row.key}-${cell.channel}`}>
          {cell.notConfigured}
        </span>
      )}
      {cell.template === null ? null : <TemplateLine row={row} cell={cell} />}
      {cell.state === "admin_off" && cell.reason !== null ? (
        <span className="admin-meta ntc-note">Reason: {cell.reason}</span>
      ) : null}
      <Counts counts={cell.counts} channel={cell.channel} days={days} />
    </li>
  );
}

const SOURCE_LABEL = { admin: "mapped here", env: "server setting", unset: "" } as const;

/**
 * Which approved template a WhatsApp or SMS cell goes out under, and where
 * that came from — with the way to the templates page, where it is changed.
 * A plain link (not NavButton): it sits inside a dense cell, and the whole
 * line is the target (44px via .ntc-template-link).
 */
function TemplateLine({ row, cell }: { row: GridRow; cell: GridCell }) {
  const template = cell.template;
  if (template === null) return null;
  const word = cell.channel === "sms" ? "DLT template" : "Template";
  const approval =
    template.approval === "approved"
      ? " · approved"
      : template.approval === "not_approved"
        ? " · not approved"
        : "";
  return (
    <a
      className="admin-meta ntc-template-link"
      href={`/admin/notifications/templates#tpl-${row.key}`}
      data-testid={`notify-template-${row.key}-${cell.channel}`}
      data-source={template.source}
    >
      {template.handle === null
        ? `${word}: none mapped`
        : `${word}: ${template.handle} (${SOURCE_LABEL[template.source]})${approval}`}
      <span className="admin-sr-only"> — manage templates for {row.label}</span>
    </a>
  );
}

/**
 * An email kind's wording, per language — what goes out now, and whether a
 * draft waits — with the way into the editor (Phase 2). Only where the wording
 * is editable: our own staff notices have no line.
 */
function WordingLine({
  kind,
  label,
  wording,
}: {
  kind: string;
  label: string;
  wording: WordingSummary;
}) {
  return (
    <div className="ntc-kind-head" data-testid={`notify-wording-${kind}`}>
      <span className="admin-meta">
        Email wording:{" "}
        {wording.languages.map((entry, index) => (
          <span key={entry.language}>
            {index === 0 ? null : " · "}
            <span lang={entry.language}>{entry.label}</span> —{" "}
            {entry.status.state === "published"
              ? `Published v${String(entry.status.version)}`
              : "Default"}
            {entry.draft === null ? null : ` (draft v${String(entry.draft)})`}
          </span>
        ))}
      </span>
      {/* NavButton, not buttonClassName(): this is a server component, and the
          kit's class helper lives in a "use client" module. */}
      <NavButton href={wording.href} variant="secondary">
        Edit email wording<span className="admin-sr-only"> — {label}</span>
      </NavButton>
    </div>
  );
}

function KindRow({
  row,
  days,
  wording,
}: {
  row: GridRow;
  days: number;
  wording: WordingSummary | undefined;
}) {
  const category = CATEGORY[row.category];
  return (
    <li data-testid={`notify-kind-${row.key}`}>
      <div className="ntc-kind-head">
        <span className="admin-cell-main">
          <span className="admin-name">{row.label}</span>
          <span className="admin-meta">{row.description}</span>
        </span>
        <Pill tone={category.tone}>{category.label}</Pill>
      </div>
      <ul className="ntc-cells" aria-label={`${row.label}, by channel`}>
        {row.cells.map((cell) => (
          <Cell key={cell.channel} row={row} cell={cell} days={days} />
        ))}
      </ul>
      {wording?.editable === true ? (
        <WordingLine kind={row.key} label={row.label} wording={wording} />
      ) : null}
      {row.locked ? (
        <p className="admin-meta">
          Sign-in codes are never stopped — not by a person, a club, or an admin.
        </p>
      ) : row.person.allowed || row.org.allowed ? (
        <div className="ntc-controls">
          {row.person.allowed ? (
            <ControlToggle
              kind={row.key}
              kindLabel={row.label}
              side="person"
              effective={row.person.effective}
            />
          ) : null}
          {row.org.allowed ? (
            <ControlToggle
              kind={row.key}
              kindLabel={row.label}
              side="org"
              effective={row.org.effective}
            />
          ) : null}
        </div>
      ) : (
        <p className="admin-meta">
          {row.category === "security"
            ? "People and clubs can never turn this off."
            : "Only an admin can turn this off."}
        </p>
      )}
    </li>
  );
}

export function NotificationsPanel({ center }: { center: NotificationCenter }) {
  return (
    <>
      <SectionCard
        icon={<IconBroadcast />}
        tone="blue"
        title="Channels"
        description="Switch a whole channel off everywhere — for a provider incident. Login codes are never stopped."
        flush
        data-testid="notify-channels"
      >
        <ul className="admin-rows">
          {center.channels.map((channel) => (
            <li key={channel.channel} data-testid={`notify-channel-${channel.channel}`}>
              <span className="admin-cell-main">
                <span className="ntc-kind-head">
                  <span className="admin-name">{channel.label}</span>
                  <Pill
                    tone={channel.enabled ? "green" : "red"}
                    dot
                    testId={`notify-channel-state-${channel.channel}`}
                  >
                    {channel.enabled ? "On" : "Off everywhere"}
                  </Pill>
                </span>
                {channel.enabled ? null : (
                  <span className="admin-meta">
                    {channel.reason === null ? "No reason given" : `Reason: ${channel.reason}`}
                    {channel.updatedAt === null ? null : (
                      <>
                        {" · "}
                        <RelativeTime at={channel.updatedAt} />
                      </>
                    )}
                  </span>
                )}
              </span>
              <ChannelControl
                channel={channel.channel}
                label={channel.label}
                enabled={channel.enabled}
              />
            </li>
          ))}
        </ul>
      </SectionCard>

      {center.groups.map((group) => (
        <SectionCard
          key={group.key}
          icon={<IconBell />}
          tone="neutral"
          title={group.label}
          description={`Counts are the last ${String(center.windowDays)} days of queued messages; codes, receipts and our own notices are sent directly and not counted here.`}
          flush
          data-testid={`notify-group-${group.key}`}
        >
          <ul className="admin-rows is-stacked">
            {group.rows.map((row) => (
              <KindRow
                key={row.key}
                row={row}
                days={center.windowDays}
                wording={center.wording[row.key]}
              />
            ))}
          </ul>
        </SectionCard>
      ))}

      <SectionCard
        icon={<IconClock />}
        tone="neutral"
        title="Recent changes"
        description="The last twenty, newest first. Revert re-applies what a change replaced, and is itself recorded."
        flush
        data-testid="notify-recent"
      >
        {center.recent.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="Nothing changed yet"
              description="Every switch here starts as the catalogue sets it. Changes appear here with who made them and why."
            />
          </div>
        ) : (
          <ul className="admin-rows is-stacked">
            {center.recent.map((change) => (
              <li key={change.id} data-testid={`notify-change-${change.id}`}>
                <span className="admin-cell-main">
                  <span className="admin-name">{change.summary}</span>
                  <span className="admin-meta">
                    {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
                    {change.revertOf === null ? null : " · a revert"}
                  </span>
                  {change.reason === null ? null : (
                    <span className="admin-meta">Reason: {change.reason}</span>
                  )}
                </span>
                {change.revertable ? (
                  <RevertButton auditId={change.id} summary={change.summary} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
