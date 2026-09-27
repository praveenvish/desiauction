"use client";

import {
  EmptyState,
  IconChevronRight,
  IconLock,
  Pill,
  SegmentedTabs,
  Toolbar,
  ToolbarCount,
  ToolbarSearch,
} from "@desiauction/ui";
import Link from "next/link";
import { useState } from "react";

import {
  filterCounts,
  filterGroups,
  type MessageFilter,
  type MessageGroup,
  type MessageRow,
} from "./messages-model";

/**
 * Every message, grouped by the moment it is sent, as a searchable list. A
 * row is a link to `?kind=` — the message opens in the side panel (a sheet on
 * a phone), the address can be shared, and Back closes it. The search and the
 * quick filters are client-side over the catalogue already on the page; they
 * survive opening a message because a soft navigation keeps this component.
 */
export function MessageList({
  groups,
  selected,
}: {
  groups: readonly MessageGroup[];
  selected: string | null;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MessageFilter>("all");
  const counts = filterCounts(groups);
  const shown = filterGroups(groups, query, filter);
  const matching = shown.reduce((sum, group) => sum + group.rows.length, 0);
  const filtered = query.trim() !== "" || filter !== "all";
  const tab = (key: MessageFilter, label: string) => ({
    key,
    label,
    count: String(counts[key]),
    active: filter === key,
    onSelect: () => {
      setFilter(key);
    },
    testId: `notify-filter-${key}`,
  });
  return (
    <section className="msg-list" aria-labelledby="msg-list-title">
      <h2 id="msg-list-title" className="admin-sr-only">
        Messages
      </h2>
      <Toolbar className="msg-toolbar">
        <ToolbarSearch
          id="msg-search"
          label="Search messages"
          placeholder="Search messages"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          testId="notify-search"
        />
        <SegmentedTabs
          label="Show"
          items={[tab("all", "All"), tab("off", "Switched off"), tab("locked", "Locked")]}
        />
        {filtered ? (
          <ToolbarCount>
            <span aria-live="polite">
              {String(matching)} of {String(counts.all)}
            </span>
          </ToolbarCount>
        ) : null}
      </Toolbar>

      {shown.length === 0 ? (
        <div className="msg-card msg-empty">
          <EmptyState
            size="compact"
            headingLevel={3}
            title="No message matches"
            description="Try another word, or show all messages."
          />
        </div>
      ) : (
        shown.map((group) => (
          <section
            key={group.key}
            className="msg-card"
            aria-labelledby={`msg-group-${group.key}`}
            data-testid={`notify-group-${group.key}`}
          >
            <header className="msg-group-head">
              <h3 id={`msg-group-${group.key}`}>{group.label}</h3>
              <span>
                {String(group.rows.length)} {group.rows.length === 1 ? "message" : "messages"}
              </span>
            </header>
            <ul className="msg-rows">
              {group.rows.map((row) => (
                <MessageRowItem key={row.key} row={row} selected={row.key === selected} />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}

function MessageRowItem({ row, selected }: { row: MessageRow; selected: boolean }) {
  return (
    <li>
      <Link
        href={`/admin/notifications?kind=${encodeURIComponent(row.key)}`}
        scroll={false}
        className="msg-row"
        aria-current={selected ? "true" : undefined}
        data-testid={`notify-kind-${row.key}`}
      >
        <span className="msg-row-main">
          <span className="msg-row-title">
            <span className="msg-row-name">{row.label}</span>
            {row.tag === null ? null : <Pill tone={row.tag.tone}>{row.tag.label}</Pill>}
            {row.off ? <Pill tone="amber">Switched off by admin</Pill> : null}
          </span>
          <span className="msg-row-desc">{row.description}</span>
          <span className="msg-chips">
            {row.chips.map((chip) => (
              <Pill key={chip.channel} tone={chip.tone} dot>
                {chip.text}
              </Pill>
            ))}
          </span>
          {row.offNotes.map((note) => (
            <span key={note} className="msg-row-note">
              {note}
            </span>
          ))}
        </span>
        <span className="msg-row-optout">
          {row.locked ? <IconLock size={16} /> : null}
          {row.optOut}
        </span>
        <IconChevronRight size={16} className="msg-row-chevron" />
      </Link>
    </li>
  );
}
