"use client";
import type { ReactNode } from "react";
import { scoringSignOut } from "../lib/scoring-sign-out";
export function ScoringSignOutForm({
  logout,
  children,
  className,
}: {
  logout: () => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form className={className} action={() => scoringSignOut(logout)}>
      {children}
    </form>
  );
}
