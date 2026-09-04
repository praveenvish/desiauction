"use client";

import { Button, Field, Select } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { useFormDialogClose } from "../../components/form-dialog";
import { createTournamentAction } from "../../server/competition/tournament-actions";

/**
 * A tournament is a name and an owning org — nothing else. It carries no
 * status, dates, teams or money; those belong to its seasons. Asking for more
 * here would be asking for facts that have no home.
 */
export function CreateTournamentForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const router = useRouter();
  const closeDialog = useFormDialogClose();
  const [state, action, pending] = useActionState(createTournamentAction, {});
  /*
   * The navigation the action used to perform itself. It cannot: this form is
   * rendered by the `@action` parallel slot on /home and /tournaments, and a
   * server-action redirect off a route whose action slot is matched is
   * abandoned by the router — the tournament is created and the page never
   * moves. `createOrgAction` carries the full measurements.
   */
  useEffect(() => {
    if (state.created !== undefined) {
      // Close first — see CreateOrgForm: the slot's dialog outlives the page.
      closeDialog();
      router.replace(`/tournaments/${state.created}`);
    }
  }, [closeDialog, router, state.created]);
  return (
    <form action={action} className="competitions-form" id="create-tournament">
      {orgs.length === 1 ? (
        <input type="hidden" name="orgId" value={orgs[0]?.id ?? ""} />
      ) : (
        <Select label="Organization" name="orgId" required>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      )}
      <Field
        label="Tournament name"
        name="name"
        required
        placeholder="Bandra Premier League"
        help="The recurring competition. Its seasons are the editions that run."
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      {/* Busy THROUGH the navigation: `pending` clears when the action
          returns, and an idle button here invites a second submit that would
          create a second tournament. */}
      <Button type="submit" loading={pending || state.created !== undefined}>
        Create tournament
      </Button>
    </form>
  );
}
