"use client";

import { Button } from "@desiauction/ui";

import { track } from "../../../lib/telemetry";

/** Submit button for the accept form — adds the product-telemetry emission. */
export function AcceptInviteButton() {
  return (
    // `lg` (52px): this is one of the two most important buttons in the whole
    // growth loop and it rendered 40px tall at 390px, under the platform's 44px
    // convention. axe never said a word — target-size is SC 2.5.5/2.5.8, not in
    // the wcag21aa tag set the scans run.
    <Button
      type="submit"
      size="lg"
      data-testid="accept-invite"
      onClick={() => {
        track("org.invitation_accepted");
      }}
    >
      Accept invitation
    </Button>
  );
}
