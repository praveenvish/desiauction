import { formatPaiseINR, paise } from "@desiauction/core";
import {
  ButtonLink,
  Card,
  EmptyState,
  IconReceipt,
  IconTile,
  IconTrophy,
  IconWallet,
  ListRow,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { competitionsView } from "../../server/competition/actions";
import { finopsOrgIds } from "../../server/financial-operations/actions";
import { myOrgs } from "../../server/orgs/actions";
import { rolesOf } from "../../server/roles/roles";
import { settlementOrgIds } from "../../server/settlement/actions";
import { myDocuments } from "../../server/financial-operations/my-documents";
import { formatDateTime } from "../../lib/format-date";
import { DOC_KIND_LABEL } from "../../server/financial-operations/register";
import "../seasons/[slug]/money/money.css";
import "./my-money.css";

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
  // The shell already read these four for its menus (each is deduped per
  // request), so the clubs' books below cost no new query.
  const [documents, orgs, view, settleIds, financeIds, roles] = await Promise.all([
    myDocuments(session.personId),
    myOrgs(),
    competitionsView(),
    settlementOrgIds(),
    finopsOrgIds(),
    rolesOf(session.personId),
  ]);
  const books = clubBooks(
    orgs,
    view.competitions,
    new Set(settleIds),
    new Set(financeIds),
    new Set(roles.organizes.map((club) => club.orgId)),
  );

  return (
    <main className={books.length > 0 ? "my-money my-money--books" : "my-money"}>
      {documents.length === 0 ? (
        /* A designed empty state, not an h2 over a sentence over 700px of
           white. It says who this page is for and where a club's own money
           lives instead. */
        <section className="my-money-empty" data-testid="my-money-empty">
          <EmptyState
            icon={<IconReceipt />}
            headingLevel={2}
            title="No receipts yet"
            description={
              books.length > 0
                ? "A receipt lands here once a club records a payment from your team."
                : "A receipt lands here once a club records a payment from your team. A club's own fees and settlement live on its money desk."
            }
            {...(books.length > 0
              ? {}
              : {
                  action: (
                    <ButtonLink href="/tournaments" size="sm">
                      Go to your tournaments
                    </ButtonLink>
                  ),
                })}
          />
        </section>
      ) : (
        <Card>
          <h2>Your receipts</h2>
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
        </Card>
      )}
      {books.length > 0 ? <ClubBooks rows={books} /> : null}
    </main>
  );
}

interface BookRow {
  key: string;
  title: string;
  meta: string;
  href?: string;
  kind: "desk" | "points" | "season";
}

/**
 * THE SECOND OBJECT (round 3C). An organizer opened "Money" and met one empty
 * card and a blank canvas, although the clubs they run have books. These are
 * the doors to them: each club's settlement and finance desk the reader holds
 * the key to, and each season in the clubs they run or hold a desk in, with a
 * points season saying plainly that it has nothing to settle (its money tab no
 * longer exists).
 * Built only from capabilities the shell already proved — no desk is shown to
 * someone who would meet a 404 behind it.
 */
function clubBooks(
  orgs: { id: string; name: string; slug: string }[],
  competitions: { orgId: string; name: string; slug: string; auctionUnit: string }[],
  settle: Set<string>,
  finance: Set<string>,
  /** Clubs this person runs: their seasons' standing is theirs to know. */
  runs: Set<string>,
): BookRow[] {
  const rows: BookRow[] = [];
  for (const org of orgs) {
    if (!settle.has(org.id) && !finance.has(org.id) && !runs.has(org.id)) continue;
    if (settle.has(org.id)) {
      rows.push({
        key: `settle-${org.id}`,
        title: `${org.name} — settlement`,
        meta: "What each team owes, what came in, what closed",
        href: `/org/${org.slug}/settlement`,
        kind: "desk",
      });
    }
    if (finance.has(org.id)) {
      rows.push({
        key: `finance-${org.id}`,
        title: `${org.name} — finance`,
        meta: "Receipts and invoices the club issues",
        href: `/org/${org.slug}/money`,
        kind: "desk",
      });
    }
    for (const season of competitions.filter((c) => c.orgId === org.id)) {
      rows.push(
        season.auctionUnit === "points"
          ? {
              key: `season-${season.slug}`,
              title: season.name,
              meta: "Ran on points — nothing to settle",
              kind: "points",
            }
          : settle.has(org.id)
            ? {
                key: `season-${season.slug}`,
                title: season.name,
                meta: "Fees and settlement for this season",
                href: `/seasons/${season.slug}/money`,
                kind: "season",
              }
            : {
                key: `season-${season.slug}`,
                title: season.name,
                meta: "Rupee season — its books are on the club desk",
                kind: "season",
              },
      );
    }
  }
  return rows;
}

function ClubBooks({ rows }: { rows: BookRow[] }) {
  return (
    <section className="my-money-books" aria-labelledby="my-money-books-title">
      <h2 id="my-money-books-title" className="my-money-books-title">
        Your clubs&rsquo; books
      </h2>
      <p className="my-money-books-lede">
        {rows.some((row) => row.kind === "desk")
          ? "The money desks you hold a key to, and where each season’s money stands."
          : "Where each season’s money stands in the clubs you run."}
      </p>
      <ul className="my-money-books-list">
        {rows.map((row) => (
          <li key={row.key}>
            <ListRow
              lead={
                <IconTile
                  icon={row.kind === "desk" ? <IconWallet /> : <IconTrophy />}
                  concept={row.kind === "desk" ? "money" : "season"}
                  size="sm"
                />
              }
              title={row.title}
              meta={row.meta}
              {...(row.href !== undefined ? { href: row.href, linkComponent: Link } : {})}
              {...(row.kind === "points" ? { status: "Points" } : {})}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
