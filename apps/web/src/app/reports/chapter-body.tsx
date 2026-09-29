"use client";

import { IconChevronDown } from "@desiauction/ui";
import { useId, useState, type ReactNode } from "react";

/**
 * A FINISHED STAGE, FOLDED ON A PHONE (census 17). Reports on a phone was
 * three long stages stacked — ~2,700px — and the one being played sat two
 * screens down, under a registration and an auction that were over. A
 * finished stage keeps its header (title, figures, CSV) and folds its detail
 * behind one tap; the current stage stays open.
 *
 * Folding is CSS under 720px and needs no script to render: the server marks
 * the body, so nothing jumps when the page hydrates, and a laptop — where the
 * stages sit side by side — never folds.
 */
export function ChapterBody({
  foldable,
  title,
  single,
  children,
}: {
  /** A finished stage while another is under way. */
  foldable: boolean;
  title: string;
  single: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const body = useId();
  return (
    <>
      {foldable ? (
        <button
          type="button"
          className="rp-fold"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open
            ? `Hide the ${title.toLowerCase()} numbers`
            : `Show the ${title.toLowerCase()} numbers`}
          <IconChevronDown size={16} aria-hidden />
        </button>
      ) : null}
      <div
        id={body}
        className="rp-chapter-body"
        data-single={single ? "" : undefined}
        data-folded={foldable && !open ? "" : undefined}
      >
        {children}
      </div>
    </>
  );
}
