"use client";

import { IconCheck, IconCopy } from "@desiauction/ui";
import { useState } from "react";

/**
 * A ULID an operator will paste into a ticket, a query or a message: one tap
 * copies it, and the glyph says so for a moment. Without clipboard access the
 * id is still selectable text beside it.
 */
export function CopyId({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="admin-copy"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1600);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
    </button>
  );
}
