"use client";

import { IconCheck } from "@desiauction/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * FIELDS THAT SAVE THEMSELVES.
 *
 * The sheet has no Save button. A select saves when it changes; a text field
 * saves when you leave it (or press Enter); each says "Saving…" and then
 * "Saved" beside its own label, so there is never a question of whether the
 * last thing typed was kept — and never a form-sized button to hunt for.
 *
 * A refusal keeps what was typed in the box, puts the reason under it, and
 * leaves the stored value alone. Escape puts the stored value back.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

export type Commit = (value: string) => Promise<{ ok: boolean; error?: string }>;

function useCommit(commit: Commit) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (fade.current !== null) {
        clearTimeout(fade.current);
      }
    },
    [],
  );

  const run = async (value: string): Promise<boolean> => {
    setState("saving");
    setError(null);
    const result = await commit(value);
    if (!result.ok) {
      setState("error");
      setError(result.error ?? "That could not be saved.");
      return false;
    }
    setState("saved");
    if (fade.current !== null) {
      clearTimeout(fade.current);
    }
    fade.current = setTimeout(() => {
      setState("idle");
    }, 1600);
    return true;
  };
  return {
    state,
    error,
    run,
    clearError: () => {
      setError(null);
    },
  };
}

function SaveMark({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="pd-save" data-state="saving" aria-live="polite">
        Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="pd-save" data-state="saved" aria-live="polite">
        <IconCheck size={12} /> Saved
      </span>
    );
  }
  return null;
}

interface BaseProps {
  label: string;
  /** The stored value. The field follows it whenever it is not being edited. */
  value: string;
  commit: Commit;
  disabled?: boolean;
  /** Why it is disabled, or what the field is for — one quiet line. */
  hint?: ReactNode;
  testId?: string;
  wide?: boolean;
}

export function TextSetting({
  label,
  value,
  commit,
  disabled,
  hint,
  testId,
  wide,
  placeholder,
  inputMode,
  type = "text",
  multiline,
}: BaseProps & {
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel";
  type?: "text" | "date";
  multiline?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const { state, error, run, clearError } = useCommit(commit);
  // Follow the stored value while nobody is typing into this box — a sheet
  // switched to the next player, or a refresh that brought a newer value.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (!editing) {
      setDraft(value);
    }
  }

  const save = async () => {
    setEditing(false);
    if (draft.trim() === value.trim()) {
      clearError();
      return;
    }
    await run(draft);
  };

  const shared = {
    id,
    value: draft,
    disabled,
    placeholder,
    "aria-invalid": error !== null ? true : undefined,
    "aria-describedby":
      error !== null ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined,
    "data-testid": testId,
    onFocus: () => {
      setEditing(true);
    },
    onBlur: () => void save(),
  };

  return (
    <div className={wide === true ? "pd-setting pd-setting-wide" : "pd-setting"}>
      <div className="pd-setting-head">
        <label htmlFor={id}>{label}</label>
        <SaveMark state={state} />
      </div>
      {multiline === true ? (
        <textarea
          {...shared}
          className="pd-input pd-textarea"
          rows={3}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(value);
              clearError();
              event.currentTarget.blur();
              event.stopPropagation();
            }
          }}
        />
      ) : (
        <input
          {...shared}
          className="pd-input"
          type={type}
          inputMode={inputMode}
          onChange={(event) => {
            setDraft(event.target.value);
            if (type === "date") {
              // A date picker has no "leaving the box" moment worth waiting
              // for; the choice is the commit.
              setEditing(false);
              if (event.target.value !== value) {
                void run(event.target.value);
              }
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(value);
              clearError();
              event.currentTarget.blur();
              event.stopPropagation();
            }
          }}
        />
      )}
      {error !== null ? (
        <p className="pd-setting-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="pd-setting-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectSetting({
  label,
  value,
  commit,
  disabled,
  hint,
  testId,
  wide,
  options,
  empty,
}: BaseProps & {
  options: readonly { value: string; label: string }[];
  /** Label for the "" option; omit to offer no empty choice. */
  empty?: string;
}) {
  const id = useId();
  const [shown, setShown] = useState(value);
  const { state, error, run } = useCommit(commit);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setShown(value);
  }
  return (
    <div className={wide === true ? "pd-setting pd-setting-wide" : "pd-setting"}>
      <div className="pd-setting-head">
        <label htmlFor={id}>{label}</label>
        <SaveMark state={state} />
      </div>
      <select
        id={id}
        className="pd-input pd-select"
        value={shown}
        disabled={disabled}
        data-testid={testId}
        aria-invalid={error !== null ? true : undefined}
        onChange={(event) => {
          const next = event.target.value;
          const previous = shown;
          setShown(next);
          void run(next).then((ok) => {
            if (!ok) {
              setShown(previous);
            }
          });
        }}
      >
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {/* A stored value the list no longer offers still shows as itself,
            rather than the select silently displaying the first option. */}
        {shown !== "" && !options.some((option) => option.value === shown) ? (
          <option value={shown}>{shown}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error !== null ? (
        <p className="pd-setting-error" role="alert">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="pd-setting-hint">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A row of choices where exactly one is current — the fee state. Buttons, not a
 * select, because there are four and the organizer should see all of them at
 * once: "who has paid?" is answered by a glance at which one is lit.
 */
export function SegmentSetting({
  label,
  value,
  commit,
  disabled,
  options,
  testId,
}: Omit<BaseProps, "hint" | "wide"> & {
  options: readonly { value: string; label: string }[];
}) {
  const [shown, setShown] = useState(value);
  const { state, error, run } = useCommit(commit);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setShown(value);
  }
  return (
    <div className="pd-setting pd-setting-wide">
      <div className="pd-setting-head">
        <span id={`${testId ?? label}-label`}>{label}</span>
        <SaveMark state={state} />
      </div>
      <div
        className="pd-segment"
        role="group"
        aria-labelledby={`${testId ?? label}-label`}
        data-testid={testId}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={shown === option.value}
            className="pd-segment-item"
            disabled={disabled}
            onClick={() => {
              if (shown === option.value) {
                return;
              }
              const previous = shown;
              setShown(option.value);
              void run(option.value).then((ok) => {
                if (!ok) {
                  setShown(previous);
                }
              });
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error !== null ? (
        <p className="pd-setting-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
