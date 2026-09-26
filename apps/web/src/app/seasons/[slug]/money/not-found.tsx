import { ButtonLink, ErrorState } from "@desiauction/ui";

import { PageTitleHidden } from "../../../../components/shell/page-title";

/**
 * A season's money, absent. The books are private to people holding the
 * money grant, so this neither confirms nor denies what exists — but it says
 * so inside the console, with a way back, instead of dropping an organizer
 * onto the marketing "Lost ball" page mid-season.
 */
export default function SeasonMoneyNotFound() {
  return (
    <main className="registrations-dash">
      <PageTitleHidden />
      <ErrorState
        headingLevel={1}
        title="No money to show here"
        description="Settlement is open only to people with the club's money access — and a page you can't read answers the same way as one that doesn't exist. Ask the club's owner if you need it."
        actions={
          <ButtonLink href="/money" variant="secondary">
            Go to Money
          </ButtonLink>
        }
      />
    </main>
  );
}
