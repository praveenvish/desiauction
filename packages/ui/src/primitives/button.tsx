"use client";

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";

import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Shared class computation so links can look like buttons (IP-1_DESIGN §9). */
export function buttonClassName(
  { variant = "primary", size = "md" }: ButtonStyleProps,
  extra?: string,
): string {
  return [styles["button"], styles[variant], styles[size], extra].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  /** Shows a spinner, disables interaction, announces busy state. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      className={buttonClassName(
        { variant, size },
        [loading ? styles["loading"] : undefined, className].filter(Boolean).join(" ") || undefined,
      )}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface ButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>, ButtonStyleProps {}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={buttonClassName({ variant, size }, className)} {...rest}>
      {children}
    </a>
  );
});
