"use client";

import { Button } from "@desiauction/ui";

import { track } from "../../../lib/telemetry";

/** Submit button for the accept form — adds the product-telemetry emission. */
export function AcceptInviteButton() {
  return (
    <Button
      type="submit"
      data-testid="accept-invite"
      onClick={() => {
        track("org.invitation_accepted");
      }}
    >
      Accept invitation
    </Button>
  );
}
