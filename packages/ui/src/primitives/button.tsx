"use client";

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";

import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Rendered heights: sm 32, md 40, touch 44, lg 52.
 *
 * `touch` exists because none of the other three sat on the platform's 44px
 * touch-target convention, and a page had no way to reach it: sm is 32 and md
 * is 40, so surfaces that needed 44 (the /c/[slug] filter bar, whose search
 * input and sort select both hand-set `min-height: 44px`) were left with a
 * button that did not match its own neighbours.
 *
 * It is a fourth rung rather than a new height for `md` on purpose. `md` is the
 * default, and 177 of this repo's 268 Button/ButtonLink call sites take it
 * implicitly — moving it would have grown almost every button in the product by
 * 4px to fix a handful of surfaces that actually care. Note also what this is
 * NOT: WCAG 2.2 AA (SC 2.5.8) asks for 24x24 and every size already clears it
 * by a wide margin. 44x44 is SC 2.5.5 (AAA) and house convention, so this is an
 * API gap to close, not a conformance failure to chase across 268 call sites.
 *
 * Reach for it on touch-first surfaces and on controls sitting beside 44px
 * inputs; `md` remains correct for dense console chrome.
 */
export type ButtonSize = "sm" | "md" | "touch" | "lg";

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
