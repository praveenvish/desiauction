"use client";

import { Button, Field } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { useFormDialogClose } from "../../components/form-dialog";
import { createOrgAction } from "../../server/orgs/actions";

export function CreateOrgForm() {
  const router = useRouter();
  const closeDialog = useFormDialogClose();
  const [state, formAction, pending] = useActionState(createOrgAction, {});
  /*
   * The navigation the SERVER used to perform. `createOrgAction` names the
   * destination rather than calling `redirect()`, because a server-action
   * redirect off `/orgs` is abandoned by the router — this form is rendered by
   * the `@action` parallel slot, and finishing that navigation would unmount
   * the very component awaiting it. The action's own doc comment records the
   * measurements. Driving the router from here completes it.
   *
   * `replace`, not `push`: the org now exists, so the list this form was opened
   * from is stale, and Back should return to whatever came BEFORE /orgs rather
   * than to a page that no longer describes the world.
   */
  useEffect(() => {
    if (state.created !== undefined) {
      // Close FIRST. The `@action` slot this dialog lives in does not swap to
      // its default on navigation, so an open modal in the shell's topbar
      // outlives the page it was opened from and blocks every control on the
      // destination.
      closeDialog();
      router.replace(`/org/${state.created}`);
    }
  }, [closeDialog, router, state.created]);
  return (
    <form action={formAction} className="create-org">
      {/* The sibling "New tournament" dialog explains what a tournament is;
          this one asked for a name and said nothing, and the placeholder
          ("Malad Premier League") named a LEAGUE — the exact thing an
          organization is not. */}
      <Field
        label="Organization name"
        name="name"
        placeholder="Malad Cricket Club"
        help="Your club's real name — 'Malad Cricket Club', not this year's league. You'll be its owner, and you can invite people once it exists."
        required
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      {/* Stays busy THROUGH the navigation. `pending` goes false the moment the
          action returns, but the work is not done until the new page is on
          screen; without `state.created` the button flicks back to idle and
          invites a second submit that would create a second organization. */}
      <Button type="submit" loading={pending || state.created !== undefined}>
        Create organization
      </Button>
    </form>
  );
}
