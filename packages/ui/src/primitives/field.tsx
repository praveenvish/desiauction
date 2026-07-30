"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DOMAttributes,
  type ForwardedRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import styles from "./field.module.css";

interface FieldChromeProps {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
}

interface ChromeIds {
  controlId: string;
  describedBy: string | undefined;
  helpId: string;
  errorId: string;
}

function useChromeIds(help?: string, error?: string): ChromeIds {
  const base = useId();
  const helpId = `${base}-help`;
  const errorId = `${base}-error`;
  const describedBy =
    [error !== undefined ? errorId : undefined, help !== undefined ? helpId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  return { controlId: `${base}-control`, describedBy, helpId, errorId };
}

function Chrome({
  ids,
  label,
  help,
  error,
  required,
  children,
}: FieldChromeProps & { ids: ChromeIds; children: ReactNode }) {
  return (
    <div className={styles["field"]}>
      <label className={styles["label"]} htmlFor={ids.controlId}>
        {label}
        {required === true ? (
          <span className={styles["required"]} aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {/*
        The message is BOTH described-by (read when focus arrives at the
        control, at any later time) and an alert (spoken the moment it
        appears, wherever the reader happens to be). Only the second half is
        new, and it has to be an insertion rather than a permanently-mounted
        empty region: this codebase renders errors from server actions, which
        replace whole field subtrees — a pre-mounted live region that is
        itself newly inserted with its text already in place is exactly the
        case screen readers do NOT announce, while a newly inserted
        role="alert" is. Keeping the node conditional also keeps the flex
        `gap` honest (an always-mounted empty span would add one gap step
        between every control and its help text).

        Conditional rendering is what stops it being chatty, too. The node is
        created when the message appears and destroyed when it clears; an
        unchanged message across re-renders touches no text node, so nothing
        is re-announced. aria-live is stated explicitly alongside role="alert"
        — it is implied, but older AT pairings honour the explicit attribute.
      */}
      {error !== undefined ? (
        <span
          className={styles["error"]}
          id={ids.errorId}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {error}
        </span>
      ) : null}
      {help !== undefined ? (
        <span className={styles["help"]} id={ids.helpId}>
          {help}
        </span>
      ) : null}
    </div>
  );
}

type Control = HTMLInputElement | HTMLSelectElement;

// Taken off the element's own attribute surface rather than named directly:
// React's FormEvent/InputEvent aliases move between major versions (and
// FormEvent is deprecated outright), while `onInvalid`/`onInput` on the
// element are exactly the shapes the JSX props demand.
type InvalidHandler<E extends Control> = NonNullable<DOMAttributes<E>["onInvalid"]>;
type InputHandler<E extends Control> = NonNullable<DOMAttributes<E>["onInput"]>;

type Validatable = Element & { willValidate: boolean; validity: ValidityState };

function isValidatable(element: Element): element is Validatable {
  return "willValidate" in element && "validity" in element;
}

/**
 * The form's first invalid control, read straight off `validity` — never via
 * checkValidity(), which fires `invalid` again and would re-enter the handler
 * that calls this.
 */
function firstInvalidIn(node: Control): Element | null {
  const form = node.form;
  if (form === null) {
    return node;
  }
  for (const element of Array.from(form.elements)) {
    if (isValidatable(element) && element.willValidate && !element.validity.valid) {
      return element;
    }
  }
  return null;
}

interface ControlWiring<E extends Control> {
  /** Ref for the DOM node; merges whatever ref the caller forwarded. */
  ref: (node: E | null) => void;
  /** The caller's error if there is one, else the browser's own complaint. */
  shownError: string | undefined;
  onInvalid: InvalidHandler<E>;
  onInput: InputHandler<E>;
}

/**
 * The behaviour Field and Select share, and the three things it repairs.
 *
 * 1 · `required` reaches the DOM again. It used to be destructured away and
 *     re-emitted as `aria-required` only, which told assistive technology the
 *     truth while leaving the browser with no constraint to enforce: an empty
 *     required input reported `validity.valid === true`, the form submitted,
 *     and the rejection cost a full server round trip. Native validation was
 *     absent product-wide. The attribute now goes through; `aria-required`
 *     stays because it is free and some AT reads it in preference.
 *
 * 2 · The UA's validation bubble is suppressed and the browser's OWN localized
 *     `validationMessage` is rendered through this component's error slot
 *     instead. Turning constraint validation on across ~every form would
 *     otherwise ship a second, competing error presentation: an unstyled
 *     tooltip that the UA positions, that vanishes on scroll or blur, that no
 *     test can assert on, and that says nothing about the field once dismissed.
 *     One presentation — ours, styled, described-by, announced — is strictly
 *     better than two. The decision has to live HERE rather than as
 *     `noValidate` on each <form>: there are ~20 form call sites, an opt-out
 *     nobody remembers to write is not a policy, and `noValidate` would also
 *     throw away the blocked submit that is the entire point of the fix.
 *
 * 3 · Focus. A failed server action re-renders with focus parked on <body> —
 *     the submit Button disables itself while `loading`, which drops focus —
 *     so the error was announced into a void the keyboard could not reach
 *     without tabbing from the top of the document. The primitive cannot learn
 *     "the form submitted" from its props, but it can watch its own <form> for
 *     a submit event, which IS that fact, and that keeps the fix in one place
 *     instead of asking twenty pages to remember a helper. Focus is only taken
 *     when it is sitting on <body>, which buys two things: a caret the user
 *     deliberately placed elsewhere is never stolen, and when several fields
 *     fail at once the FIRST in document order wins — after it takes focus,
 *     its later siblings no longer see <body> and stand down.
 */
function useControl<E extends Control>(
  error: string | undefined,
  forwarded: ForwardedRef<E>,
  callerOnInvalid: InvalidHandler<E> | undefined,
  callerOnInput: InputHandler<E> | undefined,
): ControlWiring<E> {
  const nodeRef = useRef<E | null>(null);
  const [nativeError, setNativeError] = useState<string | undefined>(undefined);
  const submittedRef = useRef(false);

  const ref = useCallback(
    (node: E | null) => {
      nodeRef.current = node;
      if (typeof forwarded === "function") {
        forwarded(node);
      } else if (forwarded !== null) {
        forwarded.current = node;
      }
    },
    [forwarded],
  );

  // A control's owning <form> is fixed for its lifetime in this codebase (no
  // call site moves a field between forms), so the listener is attached once.
  useEffect(() => {
    const form = nodeRef.current?.form ?? null;
    if (form === null) {
      return;
    }
    const mark = (): void => {
      submittedRef.current = true;
    };
    form.addEventListener("submit", mark);
    return () => {
      form.removeEventListener("submit", mark);
    };
  }, []);

  const shownError = error ?? nativeError;

  // Deliberately un-keyed: the trigger is "a render carrying an error, after a
  // submit", and neither half is a dependency React can see. `submittedRef`
  // is what keeps it inert — an unrelated re-render (a countdown tick, a
  // pending flag) never has the flag set, so it can never yank focus.
  //
  // The flag is NOT cleared by an error-free render, which is the trap this
  // walked into once: a submit re-renders the form immediately (pending goes
  // true) and the server's answer only lands a render or two later, so
  // "clean render ⇒ the submit is answered" threw the flag away before the
  // error it belonged to ever arrived. It is cleared when it is acted on, and
  // a remount (a step change, a new key) starts it false again.
  useEffect(() => {
    if (shownError === undefined || !submittedRef.current) {
      return;
    }
    // Answered either way — whether we take focus or defer to whoever holds it.
    submittedRef.current = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active !== document.documentElement) {
      return;
    }
    nodeRef.current?.focus();
  });

  const onInvalid = useCallback<InvalidHandler<E>>(
    (event) => {
      const node = event.currentTarget;
      // Suppresses the bubble only. The submit stays blocked — that is what
      // the browser does before it ever fires this event.
      event.preventDefault();
      setNativeError(node.validationMessage);
      // Cancelling `invalid` also cancels the focus move Chromium performs as
      // part of *reporting* the problem — measured, not assumed: without this
      // the submit is blocked and focus stays on the button that pressed it.
      // Restore the native contract by hand. `invalid` fires at every failing
      // control, so the first-in-document test is what keeps it to one move.
      if (firstInvalidIn(node) === node) {
        node.focus();
      }
      callerOnInvalid?.(event);
    },
    [callerOnInvalid],
  );

  const onInput = useCallback<InputHandler<E>>(
    (event) => {
      // Clear once the control is actually valid — never re-write the message
      // on every keystroke, which would turn the alert into a stutter.
      const repaired = event.currentTarget.validity.valid;
      setNativeError((current) => (current !== undefined && repaired ? undefined : current));
      callerOnInput?.(event);
    },
    [callerOnInput],
  );

  return { ref, shownError, onInvalid, onInput };
}

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id">, FieldChromeProps {}

/** Labelled text input with wired help/error messaging (GJ-1/GJ-2 forms). */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, help, error, required, className, onInvalid, onInput, ...rest },
  ref,
) {
  const wiring = useControl<HTMLInputElement>(error, ref, onInvalid, onInput);
  const ids = useChromeIds(help, wiring.shownError);
  return (
    <Chrome
      ids={ids}
      label={label}
      {...(help !== undefined ? { help } : {})}
      {...(wiring.shownError !== undefined ? { error: wiring.shownError } : {})}
      {...(required !== undefined ? { required } : {})}
    >
      <input
        ref={wiring.ref}
        id={ids.controlId}
        className={[
          styles["control"],
          wiring.shownError !== undefined ? styles["invalid"] : undefined,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        required={required}
        aria-invalid={wiring.shownError !== undefined || undefined}
        aria-describedby={ids.describedBy}
        aria-required={required === true || undefined}
        onInvalid={wiring.onInvalid}
        onInput={wiring.onInput}
        {...rest}
      />
    </Chrome>
  );
});

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id">, FieldChromeProps {}

/** Labelled native select — native semantics, FLOODLIGHT chrome. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, help, error, required, className, children, onInvalid, onInput, ...rest },
  ref,
) {
  const wiring = useControl<HTMLSelectElement>(error, ref, onInvalid, onInput);
  const ids = useChromeIds(help, wiring.shownError);
  return (
    <Chrome
      ids={ids}
      label={label}
      {...(help !== undefined ? { help } : {})}
      {...(wiring.shownError !== undefined ? { error: wiring.shownError } : {})}
      {...(required !== undefined ? { required } : {})}
    >
      <div className={styles["selectWrap"]}>
        <select
          ref={wiring.ref}
          id={ids.controlId}
          className={[
            styles["control"],
            wiring.shownError !== undefined ? styles["invalid"] : undefined,
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          required={required}
          aria-invalid={wiring.shownError !== undefined || undefined}
          aria-describedby={ids.describedBy}
          aria-required={required === true || undefined}
          onInvalid={wiring.onInvalid}
          onInput={wiring.onInput}
          {...rest}
        >
          {children}
        </select>
        <span className={styles["chevron"]} aria-hidden>
          ▾
        </span>
      </div>
    </Chrome>
  );
});
