"use client";

import { Card } from "@desiauction/ui";
import { useEffect, useSyncExternalStore } from "react";

import { roleChangeFor, signatureOf, type RoleToken } from "./role-change";

const KEY = "da:roles-seen";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
  };
}

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Private mode, blocked site data. A courtesy that cannot be remembered
    // simply is not shown — which is the right failure for a sentence.
    return null;
  }
}

/**
 * The one-time sentence for a menu that just changed (RN-1 §3.6).
 *
 * `useSyncExternalStore` rather than read-in-an-effect-and-setState: the store
 * IS localStorage, the server snapshot is null (there is no browser to ask),
 * and hydration therefore matches without a flash or a cascading render.
 *
 * MARKED SEEN ON THE WAY OUT, not on arrival. Writing the signature
 * immediately would move the store underneath the very render that is
 * displaying the notice, retracting it while the reader is mid-sentence —
 * and every trick for freezing the first read fights React rather than using
 * it (a ref read during render, a lazy initializer that captures the server
 * snapshot during hydration, a setState inside an effect). The cleanup is
 * simply the honest moment: you have seen it once you have moved on. Closing
 * the tab without navigating shows it one more time, which is the right price
 * for a sentence.
 */
export function RoleChangeNotice({ held }: { held: RoleToken[] }) {
  const seen = useSyncExternalStore(subscribe, readSeen, () => null);
  const signature = signatureOf(held);

  useEffect(
    () => () => {
      try {
        window.localStorage.setItem(KEY, signature);
      } catch {
        /* See readSeen: unavailable storage is not an error here. */
      }
    },
    [signature],
  );

  const change = roleChangeFor(held, seen);
  if (change === null) {
    return null;
  }
  return (
    <Card className="home-role-change" data-testid="home-role-change">
      <p role="status">
        <strong>{change.title}.</strong> Your menu has a new item — <b>{change.item}</b>.
      </p>
    </Card>
  );
}
