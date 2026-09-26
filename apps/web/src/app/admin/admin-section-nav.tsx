"use client";

import { IconChevronDown, useScrollStrip } from "@desiauction/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { activeAdminTab, adminNavLayout, type AdminSection } from "../../components/shell/nav";
import "./admin-nav.css";

/**
 * The administration section strip (wow pass). Same destinations, same order,
 * same `aria-current` as the shell's generic `SubNavTabs` — but it FITS: the
 * platform and people sections sit inline and the desks fold into a grouped
 * "More" menu, with the section you are on always drawn inline. See
 * `adminNavLayout` for the rule.
 *
 * The menu is a <details>, so it opens without script; with script it closes
 * on Escape, on a click outside, and after a navigation.
 */
export function AdminSectionNav({ sections }: { sections: readonly AdminSection[] }) {
  const pathname = usePathname();
  const activeKey = activeAdminTab(pathname);
  const { inline, pinned, more } = adminNavLayout(sections, activeKey);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  // A phone scrolls the strip: open it where the current section is, and fade
  // the edge that has more sections past it (the product's one scroll strip).
  useScrollStrip(stripRef, activeKey);

  useEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    menu.open = false;
    const onPointer = (event: PointerEvent) => {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pathname]);

  const tab = (section: AdminSection, extra?: string) => {
    const active = section.key === activeKey;
    return (
      <li key={section.key} className={extra}>
        <Link
          href={section.href}
          className="adn-tab"
          aria-current={active ? "page" : undefined}
          data-active={active || undefined}
        >
          {section.label}
        </Link>
      </li>
    );
  };

  return (
    <nav ref={stripRef} aria-label="Administration sections" className="adn da-scroll-strip">
      <ul className="adn-list">
        {inline.map((section) =>
          tab(section, section.dividerBefore === true ? "adn-group-start" : undefined),
        )}
        {pinned !== null ? tab(pinned, "adn-group-start adn-pinned") : null}
        {more.length > 0 ? (
          <li className="adn-more-item">
            <details ref={menuRef} className="adn-more">
              <summary className="adn-tab adn-more-button">
                More
                <IconChevronDown size={16} className="adn-caret" />
              </summary>
              <div className="adn-panel">
                {more.map((group) => (
                  <div key={group.label} className="adn-panel-group">
                    <p className="adn-panel-label">{group.label}</p>
                    <ul>
                      {group.items.map((section) => {
                        const active = section.key === activeKey;
                        return (
                          <li key={section.key}>
                            <Link
                              href={section.href}
                              className="adn-panel-link"
                              aria-current={active ? "page" : undefined}
                              data-active={active || undefined}
                            >
                              {section.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
