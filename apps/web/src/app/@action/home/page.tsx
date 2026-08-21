import { FormDialog } from "../../../components/form-dialog";
import { competitionsView } from "../../../server/competition/actions";
import { CreateTournamentForm } from "../../tournaments/create-tournament-form";

/**
 * /home — "New tournament".
 *
 * The gate is the one the page body used: somebody with no organization has
 * nothing to open a tournament in, and is sent to create a club first.
 *
 * `competitionsView` is deduped per request with React `cache`, and the shell
 * and /home's own body both already call it — so reading it here is free. That
 * is why this slot can afford to exist at all: a parallel route that had to
 * repeat an expensive query would trade a layout shift for a database round
 * trip on every render.
 */
export default async function HomeAction() {
  const { orgs } = await competitionsView();
  if (orgs.length === 0) {
    return null;
  }
  return (
    <FormDialog
      title="New tournament"
      triggerLabel="+ New tournament"
      // `touch` is the 44px rung the product standardised on. This is the
      // page's ONE primary action and it used to be 32px, at the width where 44
      // matters most.
      size="touch"
      triggerTestId="home-new-tournament"
    >
      <CreateTournamentForm orgs={orgs} />
    </FormDialog>
  );
}
