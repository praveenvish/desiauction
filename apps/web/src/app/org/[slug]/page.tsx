import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { orgView } from "../../../server/orgs/actions";
import { orgCatalogue } from "../../../server/orgs/catalogue";
import { financeAuthority } from "../../../server/financial-operations/actions";
import { moneyAuthority } from "../../../server/settlement/actions";
import { CataloguePanel } from "./catalogue-panel";
import { FinanceAuthorityPanel } from "./finance-authority";
import { MembersPanel } from "./members-panel";
import { MoneyAuthorityPanel } from "./money-authority";
import "../../orgs/orgs.css";

export const metadata = { title: "Organization · DesiAuction" };

export default async function OrgHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await orgView(slug);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (M-IP2-3 tenancy).
    notFound();
  }
  // One read PER PARTITION, concurrently: each carries both its desk's gate
  // (`settlement.view` / `finops.view`) and its grants panel. They stay separate
  // because the partitions are — settlement and finops have different writers
  // and are different acts of trust, and merging them here would blur that to
  // save one membership read on a page nobody sits on.
  //
  // Never the dashboards: a door must not cost what the room costs (the
  // settlement desk folds every case; the finance board double-derives
  // certification over every stream).
  const [authority, finance, catalogue] = await Promise.all([
    moneyAuthority(slug),
    financeAuthority(slug),
    orgCatalogue(slug),
  ]);
  return (
    <ToastProvider>
      <main className="org-home">
        <div className="org-stack">
          <div className="org-title-row">
            <h1 data-testid="org-name">{view.org.name}</h1>
            <span className="date-row">
              {authority?.canView === true ? (
                <ButtonLink href={`/org/${slug}/settlement`} data-testid="open-settlement">
                  Settlement
                </ButtonLink>
              ) : null}
              {finance?.canView === true ? (
                <ButtonLink href={`/org/${slug}/money`} data-testid="open-finance">
                  Finance
                </ButtonLink>
              ) : null}
              <ButtonLink
                href={`/org/${slug}/venues`}
                variant="secondary"
                data-testid="open-venues"
              >
                Venues
              </ButtonLink>
            </span>
          </div>
          {catalogue !== null ? <CataloguePanel catalogue={catalogue} /> : null}
          <MembersPanel view={view} slug={slug} />
          {authority !== null ? <MoneyAuthorityPanel slug={slug} authority={authority} /> : null}
          {finance !== null ? <FinanceAuthorityPanel slug={slug} authority={finance} /> : null}
        </div>
      </main>
    </ToastProvider>
  );
}
