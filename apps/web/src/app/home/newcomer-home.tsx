import { IconArrowRight } from "@desiauction/ui";
import Link from "next/link";

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
    <section className="home-choose" aria-labelledby="home-choose-title" data-testid="home-choose">
      <h2 id="home-choose-title" className="home-flat-title">
        Run a tournament, or play in one?
      </h2>
      <p>
        Organizers set up a club and run the auction night. Players find a tournament and register —
        no club needed. You can do both, and nothing here is permanent.
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
        <Link href="/c" className="home-own-poster" data-testid="home-choose-play">
          Find a tournament to play
          <IconArrowRight size={16} className="icon-trail" />
        </Link>
      </div>
    </section>
  );
}
