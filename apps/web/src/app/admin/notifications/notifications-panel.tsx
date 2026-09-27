import Link from "next/link";
import type { ReactNode } from "react";
import {
  EmptyState,
  IconAlert,
  IconBell,
  IconDevice,
  IconLock,
  IconMail,
  IconMessageCircle,
  IconPencil,
  IconTile,
  Notice,
  Pill,
  type KitTone,
} from "@desiauction/ui";

import type {
  GridCell,
  GridGroup,
  GridRow,
  NotificationCenter,
  RecentChange,
} from "../../../server/admin/notification-views";
import type { WordingSummary } from "../../../server/admin/template-views";
import { RecentFold, RelativeTime } from "../admin-ui";
import { ChannelControl, ControlToggle, RevertButton, SwitchToggle } from "./notification-controls";
import { MessageList } from "./message-list";
import { MessageSheet } from "./message-sheet";
import {
  attentionOf,
  changesFor,
  channelHealth,
  findRow,
  messageGroups,
  plainCause,
  type ChannelHealth,
} from "./messages-model";
import { formatCount } from "../../../lib/plural";

/**
 * THE MESSAGES CONTROL CENTRE, rendered on the server, in the order an
 * operator's questions come: is messaging working (the channel strip), what
 * needs me (one banner), what does a person get when X happens (the list,
 * grouped by moment), and — for one message at a time — its switches, who can
 * stop it, its wording and its history (the panel). Recent changes, with a
 * way back, sit beside it.
 *
 * ONE INSTANCE OF EVERY CONTROL: the panel is rendered for the `?kind=` in the
 * address only, so a message's switches exist once, and only while it is
 * open. The list rows carry no controls — they are links to that address.
 */

const PAGE = "/admin/notifications";

const CHANNEL_ICON: Readonly<Record<string, ReactNode>> = {
  email: <IconMail />,
  whatsapp: <IconMessageCircle />,
  sms: <IconDevice />,
  in_app: <IconBell />,
};

const HEALTH_PILL: Readonly<Record<ChannelHealth["state"], { tone: KitTone; label: string }>> = {
  live: { tone: "green", label: "Live" },
  not_set_up: { tone: "amber", label: "Not set up" },
  off: { tone: "red", label: "Off everywhere" },
};

/* ── The channel strip ─────────────────────────────────────────────────── */

function channelSub(health: ChannelHealth): ReactNode {
  if (health.state === "off") {
    return health.updatedAt === null ? (
      "Switched off"
    ) : (
      <>
        Switched off <RelativeTime at={health.updatedAt} />
      </>
    );
  }
  if (health.state === "not_set_up") {
    return `${formatCount(health.blocked)} ${health.blocked === 1 ? "message waits" : "messages wait"} for it`;
  }
  if (health.failed > 0) {
    return <span className="ntc-bad">{formatCount(health.failed)} failed</span>;
  }
  if (health.blocked > 0) {
    return `${formatCount(health.blocked)} ${health.blocked === 1 ? "message needs" : "messages need"} a template`;
  }
  return health.channel === "in_app" ? "No provider needed" : "Delivering";
}

function channelLinks(channel: string): { label: string; href: string }[] {
  return [
    { label: "Delivery analytics", href: `${PAGE}/analytics` },
    ...(channel === "whatsapp" || channel === "sms"
      ? [{ label: "Templates", href: `${PAGE}/templates` }]
      : []),
  ];
}

function ChannelStrip({ health }: { health: readonly ChannelHealth[] }) {
  return (
    <section className="ntc-strip" aria-labelledby="ntc-strip-title" data-testid="notify-channels">
      <h2 id="ntc-strip-title" className="admin-sr-only">
        Channels
      </h2>
      <ul className="ntc-channels">
        {health.map((channel) => {
          const pill = HEALTH_PILL[channel.state];
          return (
            <li
              key={channel.channel}
              className="ntc-channel"
              data-state={channel.state}
              data-testid={`notify-channel-${channel.channel}`}
            >
              <div className="ntc-channel-head">
                <IconTile icon={CHANNEL_ICON[channel.channel]} tone="neutral" size="sm" />
                <h3 className="ntc-channel-name">{channel.label}</h3>
                <Pill tone={pill.tone} testId={`notify-channel-state-${channel.channel}`}>
                  {pill.label}
                </Pill>
              </div>
              <p className="ntc-channel-line">{channel.line}</p>
              <div className="ntc-channel-foot">
                <span className="ntc-channel-sub">{channelSub(channel)}</span>
                <ChannelControl
                  channel={channel.channel}
                  label={channel.label}
                  enabled={channel.state !== "off"}
                  links={channelLinks(channel.channel)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Needs attention ───────────────────────────────────────────────────── */

function AttentionBanner({
  center,
  health,
}: {
  center: NotificationCenter;
  health: ChannelHealth[];
}) {
  const attention = attentionOf(health, center.groups);
  if (attention === null) return null;
  return (
    <Notice
      tone={health.some((channel) => channel.state === "off") ? "danger" : "warning"}
      icon={<IconAlert size={20} />}
      title={attention.title}
      testId="notify-attention"
    >
      {attention.lines.join(" ")}
      {attention.stoppedLead === null ? null : (
        <>
          {attention.lines.length > 0 ? " " : null}
          {attention.stoppedLead}{" "}
          {attention.stopped.map((message, index) => (
            <span key={message.key}>
              {index === 0 ? null : index === attention.stopped.length - 1 ? " and " : ", "}
              <Link href={`${PAGE}?kind=${encodeURIComponent(message.key)}`} scroll={false}>
                {message.label}
              </Link>
            </span>
          ))}
          .
        </>
      )}
    </Notice>
  );
}

/* ── One message, open ─────────────────────────────────────────────────── */

function stateWord(cell: GridCell): { word: string; tone: string } {
  switch (cell.state) {
    case "locked":
      return { word: "Locked", tone: "blue" };
    case "channel_off":
      return { word: "Channel off", tone: "amber" };
    case "admin_off":
      return { word: "Off by admin", tone: "red" };
    case "on":
      return cell.notConfigured === null
        ? { word: "On", tone: "green" }
        : { word: "Not configured", tone: "amber" };
  }
}

function countsLine(cell: GridCell, days: number): string {
  const c = cell.counts;
  if (c.sent + c.failed + c.suppressed === 0) return `nothing sent in ${String(days)} days`;
  const parts: string[] = [];
  if (c.sent > 0) parts.push(`${formatCount(c.sent)} sent`);
  if (c.failed > 0) parts.push(`${formatCount(c.failed)} failed`);
  if (c.suppressed > 0) parts.push(`${formatCount(c.suppressed)} suppressed`);
  if (cell.channel === "whatsapp" && c.delivered > 0) {
    parts.push(`${formatCount(c.delivered)} delivered`, `${formatCount(c.read)} read`);
  }
  return `${parts.join(" · ")} in ${String(days)} days`;
}

const SOURCE_LABEL = { admin: "mapped here", env: "server setting", unset: "" } as const;

/** Which approved template a WhatsApp or SMS message goes out under, and the way to change it. */
function TemplateLink({ row, cell }: { row: GridRow; cell: GridCell }) {
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
      className="msg-link"
      href={`${PAGE}/templates#tpl-${row.key}`}
      data-testid={`notify-template-${row.key}-${cell.channel}`}
      data-source={template.source}
      title={
        template.handle === null
          ? undefined
          : `${word}: ${template.handle} (${SOURCE_LABEL[template.source]})`
      }
    >
      {template.handle === null ? (
        `Map a ${cell.channel === "sms" ? "DLT template" : "template"}`
      ) : (
        <>
          {word}: <span className="msg-mono">{template.handle}</span>
          {approval}
          {template.source === "admin" ? (
            <span className="admin-sr-only"> (mapped here)</span>
          ) : null}
        </>
      )}
      <span className="admin-sr-only"> — {row.label}</span>
    </Link>
  );
}

/** An email message's wording in each language, and the way to the editor. */
function WordingLink({ row, wording }: { row: GridRow; wording: WordingSummary }) {
  return (
    <span className="msg-wording" data-testid={`notify-wording-${row.key}`}>
      <Link href={wording.href} className="msg-link">
        <IconPencil size={16} />
        Edit email wording
        <span className="admin-sr-only"> — {row.label}</span>
      </Link>
      <span className="msg-wording-state">
        {wording.languages.map((entry, index) => (
          <span key={entry.language}>
            {index === 0 ? null : " · "}
            <span lang={entry.language}>{entry.label}</span>:{" "}
            {entry.status.state === "published"
              ? `Published v${String(entry.status.version)}`
              : "Default"}
            {entry.draft === null ? null : ` (draft v${String(entry.draft)})`}
          </span>
        ))}
      </span>
    </span>
  );
}

function ChannelRow({
  row,
  cell,
  days,
  wording,
}: {
  row: GridRow;
  cell: GridCell;
  days: number;
  wording: WordingSummary | null;
}) {
  const state = stateWord(cell);
  return (
    <li className="msg-ch" data-state={cell.state}>
      <IconTile icon={CHANNEL_ICON[cell.channel]} tone="neutral" size="sm" />
      <div className="msg-ch-text">
        <span className="msg-ch-name">{cell.channelLabel}</span>
        <span className="msg-ch-line">
          <span
            className="ntc-state"
            data-tone={state.tone}
            data-testid={`notify-state-${row.key}-${cell.channel}`}
          >
            <span className="ntc-dot" aria-hidden />
            {state.word}
          </span>
          <span> · {countsLine(cell, days)}</span>
        </span>
        {cell.notConfigured === null ? null : (
          <span className="msg-ch-why" data-testid={`notify-why-${row.key}-${cell.channel}`}>
            {plainCause(cell.notConfigured)}
          </span>
        )}
        {cell.state === "admin_off" && cell.reason !== null ? (
          <span className="msg-ch-reason">“{cell.reason}”</span>
        ) : null}
        {cell.template === null && wording === null ? null : (
          <span className="msg-ch-links">
            <TemplateLink row={row} cell={cell} />
            {wording === null ? null : <WordingLink row={row} wording={wording} />}
          </span>
        )}
      </div>
      {row.locked ? (
        <span className="msg-ch-lock" title="Sign-in codes are never stopped">
          <IconLock size={16} />
          <span className="admin-sr-only">
            {row.label} on {cell.channelLabel}: never stopped
          </span>
        </span>
      ) : (
        <SwitchToggle
          kind={row.key}
          kindLabel={row.label}
          kindDescription={row.description}
          channel={cell.channel}
          channelLabel={cell.channelLabel}
          enabled={cell.kindEnabled}
          needsReason={row.needsReason}
        />
      )}
    </li>
  );
}

function WhoCanStop({ row }: { row: GridRow }) {
  if (row.locked) {
    return (
      <p className="msg-note">
        <IconLock size={16} />
        Never stopped — not by a person, a club, or an admin.
      </p>
    );
  }
  if (!row.person.allowed && !row.org.allowed) {
    return (
      <p className="msg-note">
        {row.category === "security"
          ? "Only an admin can stop it — people and clubs can never turn a security message off."
          : "Only an admin can stop it."}
      </p>
    );
  }
  return (
    <ul className="msg-optouts">
      {row.person.allowed ? (
        <li>
          <ControlToggle
            kind={row.key}
            kindLabel={row.label}
            side="person"
            effective={row.person.effective}
          />
        </li>
      ) : null}
      {row.org.allowed ? (
        <li>
          <ControlToggle
            kind={row.key}
            kindLabel={row.label}
            side="org"
            effective={row.org.effective}
          />
        </li>
      ) : null}
    </ul>
  );
}

function ChangeMeta({ change }: { change: RecentChange }) {
  return (
    <span className="msg-change-meta">
      {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
      {change.revertOf === null ? null : " · a revert"}
      {change.reason === null ? null : ` · “${change.reason}”`}
    </span>
  );
}

function MessageDetail({
  group,
  row,
  center,
}: {
  group: GridGroup;
  row: GridRow;
  center: NotificationCenter;
}) {
  const wording = center.wording[row.key];
  const editable = wording?.editable === true ? wording : null;
  const hasEmail = row.cells.some((cell) => cell.channel === "email");
  const history = changesFor(center.recent, row.key);
  return (
    <MessageSheet
      kind={row.key}
      eyebrow={group.label}
      title={row.label}
      description={row.description}
      closeHref={PAGE}
    >
      <section className="msg-panel-section" aria-labelledby="msg-where">
        <h3 id="msg-where" className="msg-label">
          Where it goes
        </h3>
        <ul className="msg-chs">
          {row.cells.map((cell) => (
            <ChannelRow
              key={cell.channel}
              row={row}
              cell={cell}
              days={center.windowDays}
              wording={cell.channel === "email" ? editable : null}
            />
          ))}
        </ul>
        {editable !== null && !hasEmail ? (
          <p className="msg-note">
            <WordingLink row={row} wording={editable} />
          </p>
        ) : null}
      </section>
      <section className="msg-panel-section" aria-labelledby="msg-who">
        <h3 id="msg-who" className="msg-label">
          Who can stop it
        </h3>
        <WhoCanStop row={row} />
      </section>
      <section className="msg-panel-section" aria-labelledby="msg-history">
        <h3 id="msg-history" className="msg-label">
          Changes to this message
        </h3>
        {history.length === 0 ? (
          <p className="msg-note">
            No recent changes. Every change is recorded and can be reverted.
          </p>
        ) : (
          <>
            <ul className="msg-history">
              {history.map((change) => (
                <li key={change.id}>
                  <span className="msg-change-line">{change.summary}</span>
                  <ChangeMeta change={change} />
                </li>
              ))}
            </ul>
            <p className="msg-note">Revert a change from Recent changes.</p>
          </>
        )}
      </section>
    </MessageSheet>
  );
}

/* ── Recent changes ────────────────────────────────────────────────────── */

function RecentChanges({ recent }: { recent: readonly RecentChange[] }) {
  return (
    <section
      className="msg-card msg-recent"
      aria-labelledby="msg-recent-title"
      data-testid="notify-recent"
    >
      <header className="msg-recent-head">
        <h2 id="msg-recent-title">Recent changes</h2>
        <span>Newest first · a revert is recorded too</span>
      </header>
      {recent.length === 0 ? (
        <EmptyState
          size="compact"
          headingLevel={3}
          title="Nothing changed yet"
          description="Every switch starts as the catalogue sets it. Changes appear here with who made them and why."
        />
      ) : (
        <RecentFold items={recent} className="msg-recent-list">
          {(change) => (
            <li key={change.id} data-testid={`notify-change-${change.id}`}>
              <span className="msg-recent-dot" aria-hidden />
              <span className="msg-recent-text">
                <span className="msg-change-line">{change.summary}</span>
                <ChangeMeta change={change} />
              </span>
              {change.revertable ? (
                <RevertButton auditId={change.id} summary={change.summary} />
              ) : null}
            </li>
          )}
        </RecentFold>
      )}
    </section>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */

export function NotificationsPanel({
  center,
  kind,
}: {
  center: NotificationCenter;
  kind: string | undefined;
}) {
  const health = channelHealth(center.channels, center.groups, center.windowDays);
  const open = findRow(center.groups, kind);
  return (
    <>
      <ChannelStrip health={health} />
      <AttentionBanner center={center} health={health} />
      <div className="msg-layout" data-open={open !== null || undefined}>
        <MessageList groups={messageGroups(center.groups)} selected={open?.row.key ?? null} />
        <div className="msg-side">
          {open === null ? (
            <p className="msg-hint">
              Choose a message to see where it goes, switch a channel, or change who can stop it.
            </p>
          ) : (
            <MessageDetail group={open.group} row={open.row} center={center} />
          )}
          <RecentChanges recent={center.recent} />
        </div>
      </div>
    </>
  );
}
