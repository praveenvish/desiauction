import { formatPaiseINR, paise } from "@desiauction/core";
import { Card, EmptyState, VisuallyHidden } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { myDocuments } from "../../server/financial-operations/my-documents";
import { formatDateTime } from "../../lib/format-date";
import { DOC_KIND_LABEL } from "../../server/financial-operations/register";
import "../seasons/[slug]/money/money.css";

export const metadata = { title: "My money · DesiAuction" };

/**
 * PX-2: the Money workspace ENTRY (shell scope §2).
 *
 * This rendered ONE unconditional EmptyState for every user — no branch, no
 * query — while the finance desk recorded receipts to these very people as
 * delivered. A team owner who had paid lakhs could see their receipt on no
 * surface at all: this page was a placeholder, `/inbox` has no finance writer,
 * and the org register 404s without `finops.view`.
 *
 * It now shows the documents actually issued to you. The receipts are read, not
 * derived — no amount is recomputed here; `myDocuments` reads the sealed rows.
 */
export default async function MoneyPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/money");
  }
  const documents = await myDocuments(session.personId);

  return (
    <main>
      <Card>
        <h2>Your receipts</h2>
        {documents.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="Nothing issued to you yet"
            description="When you own a team in an auction and a payment is recorded, the receipt for it appears here."
          />
        ) : (
          <>
            <p className="section-note">
              Every document a club has issued to a team you bid for. These are the sealed records —
              the same ones the club&rsquo;s finance desk holds.
            </p>
            <div
              className="table-scroll money-scroll"
              tabIndex={0}
              role="region"
              aria-label="Documents issued to you"
            >
              <table className="money-table" data-testid="my-documents">
                <caption>
                  <VisuallyHidden>Receipts and invoices issued to your teams</VisuallyHidden>
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Team</th>
                    <th scope="col">Issued</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.docId} data-testid={`my-doc-${document.docId}`}>
                      <th scope="row" data-label="Number">
                        {document.formatted}
                      </th>
                      <td data-label="Kind">{DOC_KIND_LABEL[document.kind] ?? document.kind}</td>
                      <td data-label="Team">
                        {document.teamName}
                        {document.competitionName === null ? null : (
                          <span className="section-note"> · {document.competitionName}</span>
                        )}
                      </td>
                      <td data-label="Issued">{formatDateTime(document.issuedAt)}</td>
                      <td data-label="Amount" className="num">
                        <span title={`${String(document.amount)} paise`}>
                          {formatPaiseINR(paise(document.amount))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Say what this page cannot do yet, rather than let a reader assume
                a download exists somewhere they have not looked. */}
            <p className="section-note">
              A downloadable copy isn&rsquo;t available yet. If you need one, ask the club that
              issued it.
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
