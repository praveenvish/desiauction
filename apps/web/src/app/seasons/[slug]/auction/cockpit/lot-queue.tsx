"use client";

import { PlayerPortrait } from "@desiauction/ui";
import { useMemo, useState, type ReactNode } from "react";

import { useMoney } from "../../../../../components/money-unit";
import { lotSeed } from "../../../../../lib/player-seed";
import { roleLabeller } from "../../../../../lib/role-label";
import type { LotMedia } from "../../../../../server/auction/live-summary";

// THE LOT QUEUE, FOLDED (live-room stage 3). Between lots the conductor's
// phone was ~7,200pt tall because all thirty-six queued players rendered in
// full. The list now shows the next few and folds the rest behind "Show all".
//
// The folded rows stay IN THE DOCUMENT and laid out, clipped by the list's
// height rather than removed or `display: none`: a test (or a conductor's
// keyboard) that reaches for the twentieth lot still finds a real, clickable
// button — the browser scrolls it into the clip — and focusing one unfolds
// the list, so a keyboard user never lands on a row they cannot see.

/** How many rows the folded list shows. */
export const QUEUE_FOLD = 5;

export interface QueueRow {
  /** The lot id — the React key and the media key. */
  id: string;
  lotNumber: string;
  playerName: string | null;
  role: string;
  /** The row's second line after the role (base price, or the lot's status). */
  detail: ReactNode;
  /** The suites' handle on the row (`queue-L002`, `resolve-L004`). */
  testId: string;
  actions?: ReactNode;
}

export function LotQueueList({
  rows,
  roles,
  lotMedia,
  label,
  tone,
}: {
  rows: readonly QueueRow[];
  roles: readonly { key: string; label: string }[];
  lotMedia: Readonly<Record<string, LotMedia>>;
  /** The list's accessible name ("Queued lots"). */
  label: string;
  /** `attention` marks a list of lots that need the conductor (frozen, unsold). */
  tone?: "attention";
}) {
  const labelOf = useMemo(() => roleLabeller(roles), [roles]);
  const [expanded, setExpanded] = useState(false);
  const folds = rows.length > QUEUE_FOLD;
  const folded = folds && !expanded;
  return (
    <>
      <ol
        className="lot-queue"
        aria-label={label}
        data-folded={folded ? "true" : "false"}
        data-tone={tone}
        onFocus={(event) => {
          // KEYBOARD focus on a folded row unfolds the list first. Only the
          // keyboard's (`:focus-visible`): a pointer press focuses the button
          // too, and unfolding between its mousedown and mouseup moved the row
          // out from under the pointer and swallowed the click (sim-2 caught
          // it on a sixth "Requeue").
          const target = event.target as HTMLElement;
          if (!folded || !target.matches(":focus-visible")) {
            return;
          }
          const row = target.closest("li");
          const index = row === null ? -1 : Number(row.dataset["index"] ?? -1);
          if (index >= QUEUE_FOLD) {
            setExpanded(true);
          }
        }}
      >
        {rows.map((row, index) => (
          <li key={row.id} data-testid={row.testId} data-index={index}>
            <span className="room-thumb">
              <PlayerPortrait
                name={row.playerName ?? "Unnamed"}
                seed={lotSeed(row.id, lotMedia)}
                src={lotMedia[row.id]?.photoUrl ?? null}
                decorative
              />
            </span>
            <span className="room-row-words">
              <span className="room-row-name">{row.playerName ?? "Unnamed"}</span>
              <span className="room-muted">
                {row.lotNumber}
                {row.role === "" ? "" : ` · ${labelOf(row.role)}`} · {row.detail}
              </span>
            </span>
            {row.actions === undefined ? null : (
              <span className="queue-actions">{row.actions}</span>
            )}
          </li>
        ))}
      </ol>
      {folds ? (
        <button
          type="button"
          className="room-more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show fewer" : `Show all ${String(rows.length)}`}
        </button>
      ) : null}
    </>
  );
}

/** "base 1,000 pts" — the queue row's usual second line. */
export function BaseDetail({ basePrice }: { basePrice: number }) {
  const money = useMoney();
  return <>base {money.ledger(basePrice)}</>;
}
