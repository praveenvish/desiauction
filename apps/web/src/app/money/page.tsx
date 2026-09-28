import { formatAmount, formatPaiseINR, paise } from "@desiauction/core";
import {
  ButtonLink,
  EmptyState,
  IconChevronRight,
  IconLedger,
  IconLock,
  IconReceipt,
  IconWallet,
  initialsFor,
  type KitTone,
  paintOnFill,
  Pill,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CrestImage } from "../../components/team/crest-image";
import { currentSession } from "../../server/auth/actions";
import { competitionsView } from "../../server/competition/actions";
import { finopsOrgIds } from "../../server/financial-operations/actions";
import { myOrgs } from "../../server/orgs/actions";
import { rolesOf, type OwnedTeam } from "../../server/roles/roles";
import { settlementOrgIds } from "../../server/settlement/actions";
import { seasonStandings, type SeasonStanding } from "../../server/settlement/standing";
import { seasonAuctionFacts } from "../../server/console/views";
import type { AuctionFacts } from "../../server/console/auctions-index";
import { formatCount } from "../../lib/plural";
import { CASE_STATUS_LABEL } from "../../server/settlement/worklist";
import { myDocuments, type MyDocument } from "../../server/financial-operations/my-documents";
import { formatDate } from "../../lib/format-date";
import { DOC_KIND_LABEL } from "../../server/financial-operations/register";
import "./my-money.css";

export const metadata = { title: "My money · DesiAuction" };

/**
 * PX-2: the Money workspace ENTRY (shell scope §2).
 *
 * This rendered ONE unconditional EmptyState for every user — no branch, no
 * query — while the finance desk recorded receipts to these very people as
 * delivered. It now shows the documents actually issued to you. The receipts
 * are read, not derived — `myDocuments` reads the sealed rows.
 *
 * THE REDESIGN (2026-09-27). The receipts were a five-column table squeezed
 * into half the page (four lines a row; five labelled rows a receipt on a
 * phone, 4,344px), beside a flat list of links that mixed desks with seasons
 * and carried no figure. Now: what your teams paid, then each team's sealed
 * documents on its own card, and each club you keep books for as one card —
 * its desks as buttons and every season saying where its money stands.
 *
 * The sums are sums of SEALED documents and say so: "paid" is the receipts,
 * "invoiced" the tax invoices. Nothing claims a team owes money — only that
 * an invoice has no receipt yet. The club's settlement case is the authority
 * on what is owed, and its desk is one click away.
 */
export default async function MoneyPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/money");
  }
  // The shell already read these for its menus (each is deduped per request),
  // so the clubs' books below cost no new query beyond the season standings.
  const [documents, orgs, view, settleIds, financeIds, roles, facts] = await Promise.all([
    myDocuments(session.personId),
    myOrgs(),
    competitionsView(),
    settlementOrgIds(),
    finopsOrgIds(),
    rolesOf(session.personId),
    seasonAuctionFacts(),
  ]);
  const settle = new Set(settleIds);
  const standings = new Map(
    await Promise.all(
      orgs
        .filter((org) => settle.has(org.id))
        .map(async (org) => [org.id, await seasonStandings(session.personId, org.id)] as const),
    ),
  );
  const clubs = clubBooks(
    orgs,
    view.competitions,
    settle,
    new Set(financeIds),
    new Set(roles.organizes.map((club) => club.orgId)),
    standings,
    facts,
  );
  const teams = byTeam(documents);
  /*
   * WHO THIS PAGE IS FOR (2026-09-28). An organizer who never owned a team
   * opened on "No receipts yet … from your team" — they have no team — with
   * their clubs' books squeezed into a side column. And an owner whose team
   * plays for points waited for a receipt that will never come.
   */
  const unitBySlug = new Map(view.competitions.map((season) => [season.slug, season.auctionUnit]));
  const pointsOnly =
    roles.owns.length > 0 &&
    roles.owns.every((team) => unitBySlug.get(team.competitionSlug) === "points");
  const receiptsColumn = teams.length > 0 || roles.owns.length > 0 || clubs.length === 0;

  return (
    <main
      className={
        !receiptsColumn
          ? "my-money my-money--books-only"
          : clubs.length > 0
            ? "my-money my-money--books"
            : "my-money"
      }
    >
      {receiptsColumn ? (
        <div className="mm-column">
          {teams.length === 0 && pointsOnly ? (
            <NothingToPay team={roles.owns[0]} />
          ) : teams.length === 0 ? (
            <NoReceipts owns={roles.owns} books={clubs.length > 0} />
          ) : (
            <>
              <Summary teams={teams} documents={documents.length} />
              <section className="mm-teams" aria-labelledby="mm-teams-title">
                <div className="mm-section-head">
                  <h2 id="mm-teams-title">By team</h2>
                  <span>Sealed invoices and receipts, newest first</span>
                </div>
                <ul className="mm-team-grid" data-testid="my-documents">
                  {teams.map((team) => (
                    <TeamMoney key={team.teamId} team={team} />
                  ))}
                </ul>
                {/* Say what this page cannot do yet, rather than let a reader assume
                  a download exists somewhere they have not looked. */}
                <p className="mm-foot">
                  These are the sealed records the club&rsquo;s finance desk holds. A downloadable
                  copy isn&rsquo;t available yet — ask the club that issued it.
                </p>
              </section>
            </>
          )}
        </div>
      ) : null}
      {clubs.length > 0 ? <ClubBooks clubs={clubs} /> : null}
    </main>
  );
}

// --- Your teams' money --------------------------------------------------------------

interface TeamDocs {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  teamLogoUrl: string | null;
  context: string | null;
  paid: number;
  invoiced: number;
  documents: MyDocument[];
}

/** Documents arrive newest first; each team keeps that order, teams by their newest. */
function byTeam(documents: readonly MyDocument[]): TeamDocs[] {
  const teams = new Map<string, TeamDocs>();
  for (const document of documents) {
    let team = teams.get(document.teamId);
    if (team === undefined) {
      team = {
        teamId: document.teamId,
        teamName: document.teamName,
        teamColor: document.teamColor,
        teamLogoUrl: document.teamLogoUrl,
        context:
          [document.competitionName, document.orgName]
            .filter((part): part is string => part !== null)
            .join(" · ") || null,
        paid: 0,
        invoiced: 0,
        documents: [],
      };
      teams.set(document.teamId, team);
    }
    team.documents.push(document);
    if (document.kind === "receipt") {
      team.paid += document.amount;
    } else if (document.kind === "tax-invoice") {
      team.invoiced += document.amount;
    }
  }
  return [...teams.values()];
}

const inr = (value: number) => formatPaiseINR(paise(value));

function Money({ value }: { value: number }) {
  return <span title={`${String(value)} paise`}>{inr(value)}</span>;
}

function Summary({ teams, documents }: { teams: readonly TeamDocs[]; documents: number }) {
  const paid = teams.reduce((sum, team) => sum + team.paid, 0);
  const invoiced = teams.reduce((sum, team) => sum + team.invoiced, 0);
  const unreceipted = teams.reduce((sum, team) => sum + Math.max(0, team.invoiced - team.paid), 0);
  return (
    <section className="mm-summary" aria-labelledby="mm-summary-title">
      <div className="mm-summary-main">
        <h2 id="mm-summary-title" className="mm-eyebrow">
          Your teams paid
        </h2>
        <p className="mm-total" data-testid="my-money-paid">
          <Money value={paid} />
        </p>
        <p className="mm-say" data-tone={unreceipted > 0 ? "open" : "clear"}>
          {invoiced === 0
            ? `Receipted across ${String(teams.length)} team${teams.length === 1 ? "" : "s"}.`
            : unreceipted > 0
              ? `${inr(unreceipted)} invoiced has no receipt yet.`
              : "Every invoice has its receipt — nothing open."}
        </p>
      </div>
      <dl className="mm-figures">
        {invoiced > 0 ? (
          <div>
            <dt>Invoiced</dt>
            <dd>
              <Money value={invoiced} />
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Teams</dt>
          <dd>{teams.length}</dd>
        </div>
        <div>
          <dt>Documents</dt>
          <dd>{documents}</dd>
        </div>
      </dl>
    </section>
  );
}

function TeamMark({ team, size }: { team: TeamDocs; size: number }) {
  const mono = (
    <span className="mm-mark" style={paintOnFill(team.teamColor)} aria-hidden>
      {initialsFor(team.teamName).initials ?? "?"}
    </span>
  );
  return team.teamLogoUrl !== null ? (
    <CrestImage
      className="mm-mark"
      src={team.teamLogoUrl}
      width={size}
      height={size}
      loading="lazy"
      fallback={mono}
    />
  ) : (
    mono
  );
}

function TeamMoney({ team }: { team: TeamDocs }) {
  const open = Math.max(0, team.invoiced - team.paid);
  const share = team.invoiced > 0 ? Math.min(1, team.paid / team.invoiced) : null;
  return (
    <li className="mm-team" data-testid={`my-team-${team.teamId}`}>
      <div className="mm-team-top">
        <TeamMark team={team} size={40} />
        <div className="mm-team-name">
          <h3>{team.teamName}</h3>
          {team.context !== null ? <span>{team.context}</span> : null}
        </div>
        {team.invoiced === 0 ? null : open === 0 ? (
          <Pill tone="green" dot>
            Paid in full
          </Pill>
        ) : (
          <Pill tone="amber">{`${inr(open)} not receipted`}</Pill>
        )}
      </div>
      <p className="mm-team-paid">
        <strong>
          <Money value={team.paid} />
        </strong>{" "}
        {team.invoiced > 0 ? (
          <span>
            paid of <Money value={team.invoiced} /> invoiced
          </span>
        ) : (
          <span>paid</span>
        )}
      </p>
      {share !== null ? (
        <span className="mm-bar" data-tone={open === 0 ? "green" : "gold"} aria-hidden>
          <span style={{ inlineSize: `${String(share * 100)}%` }} />
        </span>
      ) : null}
      <ul className="mm-docs">
        {team.documents.map((document) => (
          <li key={document.docId} className="mm-doc" data-testid={`my-doc-${document.docId}`}>
            <span className="mm-doc-icon" data-kind={document.kind} aria-hidden>
              {document.kind === "receipt" ? <IconReceipt size={15} /> : <IconLedger size={15} />}
            </span>
            <span className="mm-doc-body">
              <span className="mm-doc-kind">{DOC_KIND_LABEL[document.kind] ?? document.kind}</span>
              <span className="mm-doc-meta">
                <span className="mm-doc-no">{document.formatted}</span> ·{" "}
                {formatDate(document.issuedAt)}
              </span>
            </span>
            <span className="mm-doc-amount">
              <Money value={document.amount} />
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** A team that plays for points: nothing is ever invoiced, so nothing is waited for. */
function NothingToPay({ team }: { team: OwnedTeam | undefined }) {
  if (team === undefined) return null;
  return (
    <section className="mm-points" data-testid="my-money-points">
      <span className="mm-points-mark" aria-hidden>
        {initialsFor(team.teamName).initials ?? "?"}
      </span>
      <div className="mm-points-body">
        <h2>Nothing to pay — {team.competitionName} is played for points</h2>
        <p>
          {team.teamName} bought its squad with points, so no invoice or receipt will come. When a
          club charges your team in rupees, its invoice and receipt land here.
        </p>
      </div>
      <ButtonLink
        href={`/seasons/${team.competitionSlug}/teams?team=${team.teamId}`}
        size="sm"
        variant="secondary"
      >
        My team
      </ButtonLink>
    </section>
  );
}

/** Nothing issued to you yet: say what will land here, and point at your team. */
function NoReceipts({ owns, books }: { owns: readonly OwnedTeam[]; books: boolean }) {
  const team = owns[0];
  return (
    <section className="my-money-empty" data-testid="my-money-empty">
      <EmptyState
        icon={<IconReceipt />}
        headingLevel={2}
        title="No receipts yet"
        description={
          team !== undefined
            ? `When the club records a payment from ${team.teamName}, its invoice and receipt land here — sealed, with the amount and the date.`
            : books
              ? "A receipt lands here once a club records a payment from your team."
              : "A receipt lands here once a club records a payment from your team. A club's own fees and settlement live on its money desk."
        }
        {...(team !== undefined
          ? {
              action: (
                <ButtonLink
                  href={`/seasons/${team.competitionSlug}/teams?team=${team.teamId}`}
                  size="sm"
                  variant="secondary"
                >
                  Open {team.teamName}
                </ButtonLink>
              ),
            }
          : books
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
  );
}

// --- Your clubs' books --------------------------------------------------------------

interface SeasonRow {
  key: string;
  name: string;
  href?: string;
  status: { label: string; tone: KitTone } | null;
  meta: string;
}

interface ClubRow {
  orgId: string;
  name: string;
  role: string;
  settlementHref?: string;
  financeHref?: string;
  /** Rupee seasons whose money this reader holds no key to — said once, with who to ask. */
  locked: boolean;
  seasons: SeasonRow[];
}

const CASE_TONE: Record<string, KitTone> = {
  opened: "blue",
  verified: "blue",
  discrepant: "red",
  settling: "amber",
  settled: "green",
  closed: "green",
  voided: "neutral",
};

/** Where a rupee season's money stands, from the case fold (or its auction). */
function standingOf(standing: SeasonStanding | undefined): Pick<SeasonRow, "status" | "meta"> {
  if (standing === undefined || (standing.caseStatus === null && standing.auctionStatus === null)) {
    return {
      status: { label: "No auction yet", tone: "neutral" },
      meta: "Settlement opens after the auction",
    };
  }
  const status = standing.caseStatus;
  if (status === null) {
    const done = standing.auctionStatus === "completed" || standing.auctionStatus === "reconciled";
    const live = standing.auctionStatus === "live" || standing.auctionStatus === "paused";
    return done
      ? {
          status: { label: "Ready to settle", tone: "gold" },
          meta: "The auction is done — open the settlement case",
        }
      : live
        ? {
            status: { label: "Auction live", tone: "amber" },
            meta: "Settlement opens once the auction closes",
          }
        : {
            status: { label: "Auction not run yet", tone: "neutral" },
            meta: "Settlement opens after the auction",
          };
  }
  const label =
    status === "settled" ? "Settled · ready to close" : (CASE_STATUS_LABEL[status] ?? status);
  const meta =
    status === "voided"
      ? "The case was voided — nothing settled"
      : standing.totalObligations === 0
        ? status === "closed"
          ? "Sealed — nothing was owed"
          : "Dues not worked out yet"
        : status === "settling" && standing.outstanding > 0
          ? `${inr(standing.discharged)} of ${inr(standing.totalObligations)} collected · ${inr(standing.outstanding)} still owed`
          : `${inr(standing.discharged)} of ${inr(standing.totalObligations)} collected${standing.waived > 0 ? ` · ${inr(standing.waived)} waived` : ""}`;
  return { status: { label, tone: CASE_TONE[status] ?? "neutral" }, meta };
}

/**
 * THE SECOND OBJECT. An organizer's clubs, each with the desks the reader
 * holds the key to and every season saying where its money stands. Built only
 * from capabilities the shell already proved — no desk is shown to someone
 * who would meet a 404 behind it.
 */
function clubBooks(
  orgs: { id: string; name: string; slug: string }[],
  competitions: { orgId: string; id: string; name: string; slug: string; auctionUnit: string }[],
  settle: Set<string>,
  finance: Set<string>,
  /** Clubs this person runs: their seasons' standing is theirs to know. */
  runs: Set<string>,
  standings: ReadonlyMap<string, ReadonlyMap<string, SeasonStanding>>,
  facts: ReadonlyMap<string, AuctionFacts>,
): ClubRow[] {
  const clubs: ClubRow[] = [];
  for (const org of orgs) {
    if (!settle.has(org.id) && !finance.has(org.id) && !runs.has(org.id)) continue;
    const seasons: SeasonRow[] = competitions
      .filter((c) => c.orgId === org.id)
      .map((season) =>
        season.auctionUnit === "points"
          ? {
              key: season.slug,
              name: season.name,
              href: `/seasons/${season.slug}/auction`,
              status: { label: "Points", tone: "neutral" },
              meta: pointsLine(facts.get(season.id)),
            }
          : settle.has(org.id)
            ? {
                key: season.slug,
                name: season.name,
                href: `/seasons/${season.slug}/money`,
                ...standingOf(standings.get(org.id)?.get(season.id)),
              }
            : {
                // No money key: what the reader CAN see, and the season itself
                // one click away — not a pointer to a desk they can't open.
                key: season.slug,
                name: season.name,
                href: `/seasons/${season.slug}`,
                status: { label: "Rupees", tone: "neutral" },
                meta: auctionLine(facts.get(season.id)),
              },
      );
    clubs.push({
      orgId: org.id,
      name: org.name,
      role: runs.has(org.id) ? "You run this club" : "You hold a key to its money desk",
      ...(settle.has(org.id) ? { settlementHref: `/org/${org.slug}/settlement` } : {}),
      ...(finance.has(org.id) ? { financeHref: `/org/${org.slug}/money` } : {}),
      locked:
        !settle.has(org.id) &&
        competitions.some((c) => c.orgId === org.id && c.auctionUnit !== "points"),
      seasons,
    });
  }
  return clubs;
}

function ClubBooks({ clubs }: { clubs: ClubRow[] }) {
  return (
    <section className="mm-books" aria-labelledby="my-money-books-title">
      <div className="mm-section-head">
        <h2 id="my-money-books-title">Your clubs&rsquo; books</h2>
      </div>
      {clubs.map((club) => (
        <article key={club.orgId} className="mm-club" aria-labelledby={`mm-club-${club.orgId}`}>
          <div className="mm-club-top">
            <span className="mm-club-mark" aria-hidden>
              {initialsFor(club.name).initials ?? "?"}
            </span>
            <div className="mm-team-name">
              <h3 id={`mm-club-${club.orgId}`}>{club.name}</h3>
              <span>{club.role}</span>
            </div>
          </div>
          {club.settlementHref !== undefined || club.financeHref !== undefined ? (
            <div className="mm-desks">
              {club.settlementHref !== undefined ? (
                <ButtonLink href={club.settlementHref} size="sm" variant="secondary">
                  <IconWallet size={16} aria-hidden />
                  Settlement desk
                </ButtonLink>
              ) : null}
              {club.financeHref !== undefined ? (
                <ButtonLink href={club.financeHref} size="sm" variant="secondary">
                  <IconLedger size={16} aria-hidden />
                  Finance desk
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
          {club.locked ? (
            <p className="mm-locked" data-testid="money-key-note">
              <IconLock size={16} aria-hidden />
              <span>
                <strong>Its money has its own key.</strong> Settling seasons and the finance desk
                need the club&rsquo;s money role — separate from running seasons. Ask an owner of{" "}
                {club.name}.
              </span>
            </p>
          ) : null}
          {club.seasons.length > 0 ? (
            <ul className="mm-seasons">
              {club.seasons.map((season) => {
                const body = (
                  <>
                    <span className="mm-season-body">
                      <span className="mm-season-name">
                        <span>{season.name}</span>
                        {season.status !== null ? (
                          <Pill tone={season.status.tone}>{season.status.label}</Pill>
                        ) : null}
                      </span>
                      <span className="mm-season-meta">{season.meta}</span>
                    </span>
                    {season.href !== undefined ? (
                      <IconChevronRight size={16} aria-hidden className="mm-chev" />
                    ) : null}
                  </>
                );
                return (
                  <li key={season.key}>
                    {season.href !== undefined ? (
                      <Link className="mm-season" href={season.href}>
                        {body}
                      </Link>
                    ) : (
                      <div className="mm-season">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mm-season-meta">No seasons in this club yet.</p>
          )}
        </article>
      ))}
    </section>
  );
}

/** "30 sold for 1,74,500 pts — played for points, nothing to settle". */
function pointsLine(facts: AuctionFacts | undefined): string {
  if (facts === undefined || facts.lotsSold === 0) {
    return "Played for points — nothing to settle";
  }
  const spend =
    facts.moneyMoved !== undefined ? ` for ${formatAmount(paise(facts.moneyMoved), "points")}` : "";
  return `${formatCount(facts.lotsSold)} sold${spend} — played for points, nothing to settle`;
}

/** The auction's state, never its money: "Auction done · 2 teams". */
function auctionLine(facts: AuctionFacts | undefined): string {
  const teams =
    facts !== undefined && facts.teams > 0
      ? ` · ${formatCount(facts.teams)} ${facts.teams === 1 ? "team" : "teams"}`
      : "";
  switch (facts?.status) {
    case "live":
    case "paused":
      return `Auction live${teams}`;
    case "scheduled":
      return `Auction scheduled${teams}`;
    case "completed":
    case "settled":
      return `Auction done${teams}`;
    default:
      return `No auction yet${teams}`;
  }
}
