import type { ElementType, ReactNode } from "react";

/**
 * THE EYEBROW (round 3B) — the one small-caps label over a heading, on every
 * content and public page (`.da-eyebrow` in system.css). There were two: mono
 * and letter-spaced on half the pages, sans on the other half.
 */
export function Eyebrow({
  children,
  as: Tag = "p",
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return <Tag className={["da-eyebrow", className].filter(Boolean).join(" ")}>{children}</Tag>;
}
