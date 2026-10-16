"use client";

import { Button } from "@desiauction/ui";

import { useState } from "react";
import { SignOutDialog } from "../../components/sign-out-dialog";

/**
 * Sign out, and forget this device's inbox read-state on the way out.
 *
 * `logoutAction` clears the session cookie and revokes the session — everything
 * that lives on the server. The unread watermark lives in localStorage, and it
 * used to survive sign-out completely: the next person to sign in on the same
 * handset inherited a stranger's reading position. Watermarks are now
 * per-account keys (see `inboxSeenKey`), so this sweep is belt-and-braces
 * rather than the only defence — but on a shared phone, belt AND braces.
 */
export function SignOutButton({ logout }: { logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Sign out
      </Button>
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
