"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { sectionOf } from "./sections";

/**
 * OLD ANCHORS STILL LAND. Links across the product (and in emails already sent)
 * say `/account#whatsapp`, `#sports` or `#activity` — anchors on the one long
 * page this used to be. A hash never reaches the server, so this reads it once
 * after hydration and opens the section it meant.
 */
export function HashSection({ current }: { current: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const target = sectionOf(window.location.hash);
    if (target !== null && target !== current) {
      router.replace(`/account?section=${target}`, { scroll: false });
    }
  }, [current, router]);
  return null;
}
