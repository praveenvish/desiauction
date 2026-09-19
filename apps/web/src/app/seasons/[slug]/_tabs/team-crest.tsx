"use client";

import { useState } from "react";

/**
 * A team's tile: its uploaded crest, or its initials on a wash of its own
 * colour (the overview's team rows use the same formula). Always decorative —
 * the team's name is printed beside it.
 */
export function teamInitials(name: string, short?: string | null): string {
  if (short !== undefined && short !== null && short.trim() !== "" && short.trim().length <= 3) {
    return short.trim().toUpperCase();
  }
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "?").slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

export function TeamCrest({
  name,
  short,
  color,
  logoUrl,
  size = "md",
}: {
  name: string;
  short?: string | null;
  color: string | null;
  logoUrl?: string | null;
  size?: "md" | "lg" | "xl";
}) {
  const [failed, setFailed] = useState(false);
  const showLogo = logoUrl !== undefined && logoUrl !== null && !failed;
  return (
    <span
      className="st-crest"
      data-size={size === "md" ? undefined : size}
      data-logo={showLogo ? "true" : undefined}
      style={color !== null ? { ["--team" as string]: color } : undefined}
      aria-hidden
    >
      {showLogo ? (
        <img
          src={logoUrl}
          alt=""
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        teamInitials(name, short)
      )}
    </span>
  );
}
