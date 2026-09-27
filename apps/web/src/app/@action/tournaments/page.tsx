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
 * The page's ONE primary action in both of its views (2026-09-27). The "All
 * seasons" view used to swap it for "New season" through the `PageAction`
 * channel; that view now carries "New season" as its own secondary button
 * beside the list, so the bar never changes under the reader.
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
