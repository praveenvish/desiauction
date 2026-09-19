"use client";

import { REJECTION_REASONS } from "@desiauction/core";
import { Button, Dialog, Field, Select } from "@desiauction/ui";
import { useState, type ReactNode } from "react";

import { REASON_LABEL } from "./labels";

/**
 * DECLINE ASKS FIRST — one dialog for the three doors that reach it (a row, the
 * bulk bar, the player sheet).
 *
 * DA-35: no default reason. It was silently "duplicate", so every organizer who
 * did not open the select filed everybody as a duplicate.
 *
 * THE OTHER HALF OF "OTHER". Doc 42 spells the categories as "duplicate,
 * ineligible, withdrew, capacity, other+note" — the note is what makes `other`
 * mean anything, so it is required there and optional for the four that
 * already say what they mean. ORGANIZER-ONLY, and the label says so out loud,
 * because the select above it says the opposite about the reason. Invariant 6:
 * the player is told a respectful sentence built from the CATEGORY and never
 * sees these words.
 */
export function DeclineDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  testIds,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What will happen, to whom — above the reason. */
  children: ReactNode;
  confirmLabel: string;
  onConfirm: (reason: string, note: string) => Promise<void>;
  testIds: { confirm: string; note: string };
}) {
  return open ? (
    <OpenDecline
      onClose={onClose}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      testIds={testIds}
    >
      {children}
    </OpenDecline>
  ) : null;
}

/** Mounted per opening, so one player's reason and note never open on the next. */
function OpenDecline({
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  testIds,
}: {
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: (reason: string, note: string) => Promise<void>;
  testIds: { confirm: string; note: string };
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason !== "" && !(reason === "other" && note.trim() === "");
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!ready}
            data-testid={testIds.confirm}
            onClick={() => {
              setBusy(true);
              void onConfirm(reason, note).finally(() => {
                setBusy(false);
              });
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <Select
        label="Reason (the player is told this)"
        name="reason"
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      >
        <option value="">Choose a reason…</option>
        {REJECTION_REASONS.map((key) => (
          <option key={key} value={key}>
            {REASON_LABEL[key] ?? key}
          </option>
        ))}
      </Select>
      <Field
        label={
          reason === "other"
            ? "What was the reason? (organizers only)"
            : "Note for your own records (organizers only)"
        }
        name="reject-note"
        help="The player never sees this. It is here so “other” still means something a month from now."
        value={note}
        required={reason === "other"}
        onChange={(event) => {
          setNote(event.target.value);
        }}
        data-testid={testIds.note}
      />
    </Dialog>
  );
}
