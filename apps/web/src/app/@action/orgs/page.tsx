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
 * copy is gone, so this is the one definition, not a duplicate that can drift.
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
