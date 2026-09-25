"use client";

import { useState, type ElementType } from "react";

import { Drawer } from "./drawer";
import { IconMenu, IconArrowRight, IconSearch } from "./icons";
import type { PublicShellLink } from "./public-shell-types";
import styles from "./public-shell.module.css";

export interface PublicMobileMenuProps {
  nav: PublicShellLink[];
  action?: PublicShellLink;
  /** Site search, listed first — the header's search control is desktop-only. */
  searchHref?: string;
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
export function PublicMobileMenu({
  nav,
  action,
  searchHref,
  linkComponent: Link = "a",
}: PublicMobileMenuProps) {
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
        <IconMenu size={24} />
      </button>
      {/* Mounted only while open. A <dialog> stays in the DOM when closed, and
          the Drawer titles itself with an <h2> — so an always-mounted menu put
          a level-2 heading ahead of every page's <h1>, on every public page, at
          every width, opening the document outline on a heading that belongs to
          a closed panel. Nothing is lost by mounting late: the drawer has no
          state to keep between openings. */}
      {open ? (
        <Drawer open onClose={close} title="Explore" className={styles["mobile-panel"] ?? ""}>
          <p className={styles["drawer-intro"]}>Your sport. Your people. Your moment.</p>
          <nav aria-label="Site" className={styles["drawer-nav"] ?? ""}>
            {searchHref !== undefined ? (
              <Link
                href={searchHref}
                className={`${styles["drawer-link"] ?? ""} ${styles["drawer-search"] ?? ""}`}
                onClick={close}
              >
                <span className={styles["drawer-search-label"]}>
                  <IconSearch size={20} />
                  Search the site
                </span>
              </Link>
            ) : null}
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
                      <IconArrowRight size={16} />
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
                  <IconArrowRight size={16} />
                </Link>
              ),
            )}
          </nav>
          {action !== undefined ? (
            <Link href={action.href} className={styles["mobile-action"]} onClick={close}>
              {action.label}
              <IconArrowRight size={16} />
            </Link>
          ) : null}
        </Drawer>
      ) : null}
    </>
  );
}
