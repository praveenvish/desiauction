import { FormDialog } from "../../../components/form-dialog";
import { CreateOrgForm } from "../../orgs/create-org-form";

/**
 * /orgs — "New organization".
 *
 * Unconditional: anyone who can reach the organizations index can start one,
 * so there is no capability read here and nothing to gate on.
 *
 * The node is identical to the one the page used to publish through
 * `PageAction`; what changed is only WHERE it is rendered from. The page's
 * header copy is gone, so this is the one definition of the PAGE ACTION.
 *
 * The empty state on /orgs still offers its own "Create your organization"
 * button, and it renders ALONGSIDE this one whenever the list is empty. That is
 * deliberate — but it carries `new-org-empty`, not `new-org`, because sharing
 * the id made every `getByTestId("new-org")` in the e2e suite ambiguous exactly
 * when it mattered: a brand-new account, which is the only kind the specs have.
 */
export default function OrgsAction() {
  return (
    <FormDialog
      title="New organization"
      triggerLabel="+ New organization"
      size="touch"
      triggerTestId="new-org"
    >
      <CreateOrgForm />
    </FormDialog>
  );
}
