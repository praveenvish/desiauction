import { FormDialog } from "../../../components/form-dialog";
import { creatableOrgs } from "../../../server/competition/tournament-actions";
import { CreateTournamentForm } from "../../tournaments/create-tournament-form";

/**
 * /tournaments — "New tournament".
 *
 * MEMBERSHIP IS NOT PERMISSION, so this reads `creatableOrgs` rather than the
 * membership list: `org:staff` holds `registration.review` and not
 * `competition.create`. The forms are handed the same list, so a multi-org
 * picker cannot offer an org the server will refuse.
 *
 * The index has TWO views and an action for each — "New tournament" for the
 * grouped view, "New season" for the flat one — and which is showing is client
 * state. This renders the grouped view's action, which is the default the
 * server picks; when a reader flips to seasons, the browser publishes the other
 * one through the existing `PageAction` channel and the shell prefers it. The
 * two are the same control at the same size, so that swap moves nothing.
 */
export default async function TournamentsAction() {
  const createIn = await creatableOrgs();
  if (createIn.length === 0) {
    return null;
  }
  return (
    <FormDialog
      title="New tournament"
      triggerLabel="+ New tournament"
      size="touch"
      triggerTestId="new-tournament"
    >
      <CreateTournamentForm orgs={createIn} />
    </FormDialog>
  );
}
