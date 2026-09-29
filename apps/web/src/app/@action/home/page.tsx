import { FormDialog } from "../../../components/form-dialog";
import { currentSession } from "../../../server/auth/actions";
import { competitionsView } from "../../../server/competition/actions";
import { rolesOf } from "../../../server/roles/roles";
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
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  // Offered to people who MANAGE a club, in the clubs they manage. A team owner
  // or a plain member used to see it too — belonging is not permission.
  const [{ orgs }, roles] = await Promise.all([competitionsView(), rolesOf(session.personId)]);
  const managed = new Set(roles.organizes.map((club) => club.orgId));
  const creatable = orgs.filter((org) => managed.has(org.id));
  if (creatable.length === 0) {
    return null;
  }
  return (
    <FormDialog
      title="New tournament"
      triggerLabel="+ New tournament"
      // `touch` is the 44px rung the product standardised on (it used to be
      // 32px, at the width where 44 matters most). Secondary: home's body
      // always carries its own primary — the next step, or "Enter score" on a
      // match day — and a gold "+ New tournament" competed with it (census 14).
      size="touch"
      variant="secondary"
      triggerTestId="home-new-tournament"
    >
      <CreateTournamentForm orgs={creatable} />
    </FormDialog>
  );
}
