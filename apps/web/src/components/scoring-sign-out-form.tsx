"use client";
import { useState, type ReactNode } from "react";
import { SignOutDialog } from "./sign-out-dialog";
export function ScoringSignOutForm({
  logout,
  children,
  className,
}: {
  logout: () => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <form
        className={className}
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </form>
      <SignOutDialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        logout={logout}
      />
    </>
  );
}
