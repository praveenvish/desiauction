"use client";

import { IconClose } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

/**
 * ONE MESSAGE, OPEN — the side panel on a laptop, a bottom sheet on a phone.
 *
 * The page renders the panel for the `?kind=` in the address and for nothing
 * else, so every switch, state and link in it exists exactly once on the page
 * (the suites find them by test id). This island only decides the frame: an
 * <aside> beside the list, or — under 1100px — a native modal <dialog>
 * (focus trap, Escape, backdrop, top layer; a security confirm opened from it
 * stacks above it). The server renders the aside; a phone upgrades to the
 * dialog after hydration, before anything in it has state worth keeping.
 *
 * Closing is navigation, like opening: the ✕ is a link to the list, and
 * Escape or the backdrop go there too — so Back and forward work as expected.
 */

const PHONE = "(max-width: 1099px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

export function MessageSheet({
  kind,
  eyebrow,
  title,
  description,
  closeHref,
  children,
}: {
  kind: string;
  eyebrow: string;
  title: string;
  description: string;
  closeHref: string;
  children: ReactNode;
}) {
  const phone = usePhone();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownKind = useRef<string | null>(null);
  const titleId = `msg-panel-title-${kind}`;

  useEffect(() => {
    const node = dialogRef.current;
    if (phone && node !== null && !node.open) {
      node.showModal();
    }
  }, [phone]);

  // A new message chosen from the list: the reader lands on its name. The
  // first render is left alone — a shared link should not steal the focus.
  useEffect(() => {
    if (shownKind.current !== null && shownKind.current !== kind) {
      headingRef.current?.focus({ preventScroll: phone });
    }
    shownKind.current = kind;
  }, [kind, phone]);

  const close = () => {
    router.push(closeHref, { scroll: false });
  };

  const body = (
    <>
      {phone ? <span className="msg-sheet-grip" aria-hidden /> : null}
      <header className="msg-panel-head">
        <div className="msg-panel-titles">
          <span className="msg-eyebrow">{eyebrow}</span>
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="msg-panel-title">
            {title}
          </h2>
          <p className="msg-panel-desc">{description}</p>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          className="msg-panel-close"
          aria-label={`Close ${title}`}
          data-testid="notify-panel-close"
        >
          <IconClose size={20} />
        </Link>
      </header>
      {children}
    </>
  );

  if (phone) {
    return (
      // A modal <dialog> closes on Escape natively (→ onClose); the click
      // handler only catches the backdrop, like the kit's Drawer.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <dialog
        ref={dialogRef}
        className="msg-panel msg-sheet"
        aria-labelledby={titleId}
        data-testid="notify-panel"
        onClose={close}
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
      >
        {body}
      </dialog>
    );
  }
  return (
    <aside className="msg-panel" aria-labelledby={titleId} data-testid="notify-panel">
      {body}
    </aside>
  );
}
