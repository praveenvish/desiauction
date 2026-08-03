"use client";

import { Button } from "@desiauction/ui";

import { clearInboxWatermarks } from "../../lib/inbox-events";

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
  return (
    <form
      action={logout}
      onSubmit={() => {
        clearInboxWatermarks();
      }}
    >
      <Button type="submit" variant="secondary">
        Sign out
      </Button>
    </form>
  );
}
