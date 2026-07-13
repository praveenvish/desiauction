"use client";

import {
  forwardRef,
  useId,
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
      {error !== undefined ? (
        <span className={styles["error"]} id={ids.errorId}>
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

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id">, FieldChromeProps {}

/** Labelled text input with wired help/error messaging (GJ-1/GJ-2 forms). */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, help, error, required, className, ...rest },
  ref,
) {
  const ids = useChromeIds(help, error);
  return (
    <Chrome
      ids={ids}
      label={label}
      {...(help !== undefined ? { help } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(required !== undefined ? { required } : {})}
    >
      <input
        ref={ref}
        id={ids.controlId}
        className={[
          styles["control"],
          error !== undefined ? styles["invalid"] : undefined,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={ids.describedBy}
        aria-required={required === true || undefined}
        {...rest}
      />
    </Chrome>
  );
});

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id">, FieldChromeProps {}

/** Labelled native select — native semantics, FLOODLIGHT chrome. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, help, error, required, className, children, ...rest },
  ref,
) {
  const ids = useChromeIds(help, error);
  return (
    <Chrome
      ids={ids}
      label={label}
      {...(help !== undefined ? { help } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(required !== undefined ? { required } : {})}
    >
      <div className={styles["selectWrap"]}>
        <select
          ref={ref}
          id={ids.controlId}
          className={[
            styles["control"],
            error !== undefined ? styles["invalid"] : undefined,
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={ids.describedBy}
          aria-required={required === true || undefined}
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
