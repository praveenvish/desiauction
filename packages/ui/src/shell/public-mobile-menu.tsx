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
 * below 960px, so without this the marketing nav is unreachable on a phone or
 * a portrait tablet.
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
      {/* Mounted only while open. A <dialog> stays in the DOM when closed, and
          the Drawer titles itself with an <h2> — so an always-mounted menu put
          a level-2 heading ahead of every page's <h1>, on every public page, at
          every width, opening the document outline on a heading that belongs to
          a closed panel. Nothing is lost by mounting late: the drawer has no
          state to keep between openings. */}
      {open ? (
        <Drawer open onClose={close} title="Menu">
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
                      aria-current={child.active === true ? "page" : undefined}
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
                  aria-current={link.active === true ? "page" : undefined}
                  onClick={close}
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        </Drawer>
      ) : null}
    </>
  );
}
