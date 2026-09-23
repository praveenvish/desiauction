import { ButtonLink, IconArrowRight, IconSpark, SectionCard } from "@desiauction/ui";

import { FormDialog } from "../../components/form-dialog";
import { CreateOrgForm } from "../orgs/create-org-form";

/**
 * THE FIRST SCREEN, for somebody who holds nothing yet.
 *
 * Its one job (RN-1 §0): which am I? Two doors and nothing else — the product
 * cannot know yet, and guessing produces the dashboard-shaped skeleton that
 * used to greet every new account: four lifecycle stages at 0, a flat ₹0 chart
 * and three empty panels, at the moment one of five steps was done.
 *
 * The organizer door is a dialog rather than a link because creating the club
 * IS the first step; sending somebody to an empty index to find the same button
 * is a page in between that teaches nothing.
 */
export function NewcomerHome() {
  return (
    <SectionCard
      data-testid="home-choose"
      icon={<IconSpark />}
      tone="gold"
      title="Run a tournament, or play in one?"
      description="You can do both, and nothing here is permanent."
    >
      <p className="home-card-note">
        Organizers set up a club and run the auction night. Players find a tournament and register —
        no club needed.
      </p>
      <div className="home-choose-doors">
        <FormDialog
          title="New organization"
          triggerLabel="Create your club"
          size="touch"
          triggerTestId="home-create-org"
        >
          <CreateOrgForm />
        </FormDialog>
        <ButtonLink href="/c" variant="secondary" size="touch" data-testid="home-choose-play">
          Find a tournament to play
          <IconArrowRight size={16} className="icon-trail" />
        </ButtonLink>
      </div>
    </SectionCard>
  );
}
