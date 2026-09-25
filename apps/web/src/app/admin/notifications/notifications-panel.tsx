import Link from "next/link";
import type { CSSProperties } from "react";
import {
  EmptyState,
  IconBell,
  IconBroadcast,
  IconClock,
  IconLock,
  IconPencil,
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
  // The cell draws the one figure that matters at a glance (sent, and failed
  // when there were any); the whole line is announced and on hover.
  return (
    <span className="ntc-counts" title={`Last ${String(days)} days: ${parts.join(" · ")}`}>
      <span aria-hidden>
        <span data-zero={counts.sent === 0 || undefined}>
          {counts.sent.toLocaleString("en-IN")} sent
        </span>
        {counts.failed > 0 ? (
          <span className="ntc-counts-bad"> · {counts.failed.toLocaleString("en-IN")} failed</span>
        ) : null}
      </span>
      <span className="admin-sr-only">
        Last {String(days)} days: {parts.join(" · ")}
      </span>
    </span>
  );
}

function Cell({
  row,
  cell,
  days,
  column,
  shared,
}: {
  row: GridRow;
  cell: GridCell;
  days: number;
  column: number;
  /** The column head already says why nothing can go on this channel. */
  shared: boolean;
}) {
  return (
    <li className="ntc-cell" data-state={cell.state} style={{ gridColumn: column, gridRow: 1 }}>
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
        // Said once in the column head when the whole column shares it; the
        // cell keeps the sentence for assistive tech and on hover.
        <span
          className="admin-meta ntc-note ntc-why"
          data-shared={shared || undefined}
          title={cell.notConfigured}
          data-testid={`notify-why-${row.key}-${cell.channel}`}
        >
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
    <Link
      className="admin-meta ntc-template-link"
      title={
        template.handle === null
          ? `${word}: none mapped`
          : `${word}: ${template.handle} (${SOURCE_LABEL[template.source]})${approval}`
      }
      href={`/admin/notifications/templates#tpl-${row.key}`}
      data-testid={`notify-template-${row.key}-${cell.channel}`}
      data-source={template.source}
    >
      {template.handle === null ? `${word}: none` : template.handle}
      {template.handle !== null && template.source === "admin" ? (
        <span className="admin-sr-only"> (mapped here)</span>
      ) : null}
      <span className="admin-sr-only"> — manage templates for {row.label}</span>
    </Link>
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
    <div className="ntc-wording" data-testid={`notify-wording-${kind}`}>
      <span className="admin-meta">
        Wording:{" "}
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
      <Link href={wording.href} className="ntc-wording-link">
        <IconPencil size={16} />
        <span className="admin-sr-only">Edit email wording — {label}</span>
        <span aria-hidden>Edit</span>
      </Link>
    </div>
  );
}

function KindRow({
  row,
  days,
  wording,
  columns,
}: {
  row: GridRow;
  days: number;
  wording: WordingSummary | undefined;
  columns: readonly { channel: string; note: string | null }[];
}) {
  const category = CATEGORY[row.category];
  const editable = wording?.editable === true;
  return (
    <li className="ntc-kind" data-testid={`notify-kind-${row.key}`}>
      <div className="ntc-kind-name">
        <span className="admin-name">{row.label}</span>
        <span className="admin-meta ntc-kind-desc" title={row.description}>
          {row.description}
        </span>
        <Pill tone={category.tone}>{category.label}</Pill>
      </div>
      <ul className="ntc-cells" aria-label={`${row.label}, by channel`}>
        {row.cells.map((cell) => (
          <Cell
            key={cell.channel}
            row={row}
            cell={cell}
            days={days}
            column={columns.findIndex((column) => column.channel === cell.channel) + 1}
            shared={columns.some(
              (column) => column.channel === cell.channel && column.note === cell.notConfigured,
            )}
          />
        ))}
      </ul>
      <div className="ntc-kind-foot">
        {row.locked ? (
          <span className="admin-meta">
            <IconLock size={16} /> Never stopped — not by a person, a club, or an admin.
          </span>
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
          <span className="admin-meta">
            {row.category === "security"
              ? "People and clubs can never turn this off."
              : "Only an admin can turn this off."}
          </span>
        )}
        {editable ? <WordingLine kind={row.key} label={row.label} wording={wording} /> : null}
      </div>
    </li>
  );
}

/**
 * The columns a group needs — its channels, in the channel switches' order —
 * and, per column, the "not set up" sentence when EVERY cell in it shares it:
 * said once in the head instead of forty times down the grid.
 */
function groupColumns(
  rows: readonly GridRow[],
  order: readonly { channel: string; label: string }[],
): { channel: string; label: string; note: string | null }[] {
  return order
    .filter((entry) => rows.some((row) => row.cells.some((cell) => cell.channel === entry.channel)))
    .map((entry) => {
      const cells = rows.flatMap((row) =>
        row.cells.filter((cell) => cell.channel === entry.channel),
      );
      const first = cells[0]?.notConfigured ?? null;
      const shared = first !== null && cells.every((cell) => cell.notConfigured === first);
      return { channel: entry.channel, label: entry.label, note: shared ? first : null };
    });
}

export function NotificationsPanel({ center }: { center: NotificationCenter }) {
  return (
    <>
      <SectionCard
        icon={<IconBroadcast />}
        tone="blue"
        title="Channels"
        description="Kill switches for a provider incident. Login codes are never stopped."
        flush
        data-testid="notify-channels"
      >
        <ul className="ntc-channels">
          {center.channels.map((channel) => (
            <li
              key={channel.channel}
              className="ntc-channel"
              data-on={channel.enabled || undefined}
              data-testid={`notify-channel-${channel.channel}`}
            >
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

      {center.groups.map((group) => {
        const columns = groupColumns(group.rows, center.channels);
        return (
          <SectionCard
            key={group.key}
            icon={<IconBell />}
            tone="neutral"
            title={group.label}
            description={`${String(group.rows.length)} message${group.rows.length === 1 ? "" : "s"} · counts are the last ${String(center.windowDays)} days`}
            flush
            data-testid={`notify-group-${group.key}`}
          >
            {/* One switchboard per group: a column per channel, a row per
                message. It used to be a card per message holding a card per
                channel — about 11,000px for the whole catalogue. */}
            <div
              className="ntc-matrix"
              style={{ "--ntc-cols": String(columns.length) } as CSSProperties}
            >
              <div className="ntc-kind ntc-matrix-head" aria-hidden>
                <span>Message</span>
                <span className="ntc-cells">
                  {columns.map((column) => (
                    <span key={column.channel} className="ntc-col-head">
                      {column.label}
                      {column.note !== null ? (
                        <span className="ntc-col-note" title={column.note}>
                          Not set up
                        </span>
                      ) : null}
                    </span>
                  ))}
                </span>
              </div>
              <ul className="ntc-kinds">
                {group.rows.map((row) => (
                  <KindRow
                    key={row.key}
                    row={row}
                    days={center.windowDays}
                    wording={center.wording[row.key]}
                    columns={columns}
                  />
                ))}
              </ul>
            </div>
          </SectionCard>
        );
      })}

      <SectionCard
        icon={<IconClock />}
        tone="neutral"
        title="Recent changes"
        description="Last twenty, newest first · a revert is itself recorded"
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
          <ul className="admin-rows ntc-recent">
            {center.recent.map((change) => (
              <li key={change.id} data-testid={`notify-change-${change.id}`}>
                <span className="admin-cell-main">
                  <span className="ntc-recent-line">{change.summary}</span>
                  <span className="admin-meta">
                    {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
                    {change.revertOf === null ? null : " · a revert"}
                    {change.reason === null ? null : ` · “${change.reason}”`}
                  </span>
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
