"use client";

import { useState, type ElementType } from "react";

import { Drawer } from "./drawer";
import { IconMenu } from "./icons";
import type { PublicShellLink } from "./public-shell-types";
import styles from "./public-shell.module.css";

export interface PublicMobileMenuProps {
  nav: PublicShellLink[];
  linkComponent?: ElementType;
}

/**
 * The public header's small-screen navigator: the desktop `.nav` is hidden
 * below 720px, so without this the marketing nav is unreachable on a phone.
 * A hamburger opens the shared Drawer (native <dialog>: focus trap + Escape)
 * listing every header link — grouped links (e.g. Resources) render their
 * children under the group label. Nav-only by design: the header's own action
 * (Sign in / Open console) stays visible beside the trigger at every width.
 */
export function PublicMobileMenu({ nav, linkComponent: Link = "a" }: PublicMobileMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className={styles["menu-button"] ?? ""}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        <IconMenu />
      </button>
      <Drawer open={open} onClose={close} title="Menu">
        <nav aria-label="Site" className={styles["drawer-nav"] ?? ""}>
          {nav.map((link) =>
            link.children !== undefined && link.children.length > 0 ? (
              <div key={link.label} className={styles["drawer-group"] ?? ""}>
                <span className={styles["drawer-group-label"] ?? ""}>{link.label}</span>
                {link.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={styles["drawer-link"] ?? ""}
                    onClick={close}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={styles["drawer-link"] ?? ""}
                onClick={close}
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
      </Drawer>
    </>
  );
}
