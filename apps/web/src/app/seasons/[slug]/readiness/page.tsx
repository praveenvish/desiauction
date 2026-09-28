import { ButtonLink, IconAlert, IconCheck, Pill, type KitTone } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auctionDashboard } from "../../../../server/auction/actions";
import { competitionView, registrationDashboard } from "../../../../server/competition/actions";
import { fixtureDashboard, venuesView } from "../../../../server/competition/fixture-actions";
import { myOrgs } from "../../../../server/orgs/actions";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "./readiness.css";
import { readinessSteps, readinessTitle, shortfallSentence } from "./readiness-model";

export const metadata = { title: "Readiness · DesiAuction" };

// PX-4 Readiness Center: ONE unified view that SURFACES existing validation.
// The only pass/fail authority here is the platform's own AuctionReady
// projection (auction-ready.ts); everything else is counts from existing
// dashboards with links to the screen that changes them. No rules invented.
/** Where each auction gate is cleared. */
function fixOf(id: string, base: string): { href: string; label: string } {
  switch (id) {
    case "intake_closed":
      return { href: base, label: "Close registration" };
    case "pool_present":
      return { href: `${base}/registrations`, label: "Review registrations" };
    case "teams_present":
      return { href: `${base}/teams`, label: "Add teams" };
    default:
      return { href: `${base}/auction`, label: "Open auction setup" };
  }
}

/** A season status in words — the gate's own detail is the raw enum. */
const STATUS_WORDS: Record<string, string> = {
  draft: "The season is still a draft",
  setup: "The season is in setup",
  registration_open: "Registration is open",
  registration_closed: "Registration is closed",
};

/**
 * The gate's detail, readable. The projection reports the intake gate as
 * "competition is registration closed" — the enum with its underscores taken
 * out, which is a log line, not a sentence. Every other detail already reads.
 */
function checkDetail(check: { id: string; detail: string }, status: string): string {
  return check.id === "intake_closed" ? (STATUS_WORDS[status] ?? check.detail) : check.detail;
}

export default async function ReadinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await competitionView(slug);
  if (view === null) {
    notFound();
  }
  const [registrations, fixtures, auction, orgs] = await Promise.all([
    registrationDashboard(slug, {}),
    fixtureDashboard(slug, {}),
    auctionDashboard(slug),
    myOrgs(),
  ]);
  const org = orgs.find((entry) => entry.id === view.competition.orgId) ?? null;
  const venues = org !== null ? await venuesView(org.slug) : null;
  const activeGrounds =
    venues?.venues.flatMap((venue) => venue.grounds).filter((g) => g.status === "active").length ??
    0;
  const base = `/seasons/${slug}`;
  const checks = auction?.ready.checks ?? [];
  /*
   * AFTER THE HAMMER THIS PAGE IS A RECORD, NOT A CHECKLIST. It used to keep
   * asking "can I start?" of an auction that had already run.
   */
  const auctionStatus = auction?.view?.auction.status ?? null;
  const auctionOver = auctionStatus === "completed" || auctionStatus === "reconciled";
  const auctionLive = auctionStatus === "live" || auctionStatus === "paused";
  const auctionCreated = auction?.view !== null && auction?.view !== undefined;
  const regStats = registrations?.stats;
  const pending = regStats?.submitted ?? 0;
  /*
   * THE STEPS ARE THE COUNT. The corner pill said "1 blocker" while the list
   * under it drew two red marks — "the auction exists" was drawn blocked and
   * never counted. Title, button and marks now read from one list.
   */
  const steps =
    auction === null || auctionOver || auctionLive
      ? []
      : readinessSteps({ checks, auctionCreated, pending, base });
  /*
   * Squad feasibility is deliberately NOT a step: a league may knowingly run
   * short, but it must not find out at closing time — so it is said as a
   * sentence with the ways out, and the verdict carries the caveat.
   */
  const short =
    auction === null || auctionOver ? null : shortfallSentence(auction.feasibility, pending);
  const runningShort = short !== null;
  const fixtureCount = fixtures?.stats.total ?? 0;
  // The public record, counted the way the Schedule counts it: a match being
  // played or already played was published first. "3 of 7 published" on a
  // season with 3 played and 1 live read as a schedule not yet out.
  const played = fixtures?.stats.completed ?? 0;
  const liveMatches = fixtures?.stats.inProgress ?? 0;
  const published = (fixtures?.stats.published ?? 0) + liveMatches + played;
  const conflicts = (fixtures?.conflicts ?? []).length;

  const verdictPill = auctionOver
    ? { tone: "green" as KitTone, label: "Auction completed" }
    : auctionLive
      ? { tone: "green" as KitTone, label: "Auction live" }
      : auction !== null && steps.length === 0
        ? {
            tone: (runningShort ? "amber" : "green") as KitTone,
            label: runningShort ? "Ready — but running short" : "Ready for auction",
          }
        : { tone: "amber" as KitTone, label: "Not ready yet" };

  const title = auctionOver
    ? fixtureCount > 0 && published === fixtureCount && conflicts === 0
      ? "The auction is done — the schedule is out"
      : "The auction is done — next is the match schedule"
    : auctionLive
      ? "The auction is live"
      : readinessTitle(steps.length);
  const firstStep = steps[0];
  const primary = auctionOver
    ? {
        label: fixtureCount === 0 ? "Build fixtures" : "Open fixtures",
        href: `${base}/fixtures`,
      }
    : auctionLive
      ? { label: "Open the cockpit", href: `${base}/auction/cockpit` }
      : firstStep !== undefined
        ? firstStep.action
        : { label: "Open auction setup", href: `${base}/auction` };

  /*
   * ONE CHECKLIST (2026-09-28). Every gate was said three times — a numbered
   * step, a check row and an "area" card ("Close registration" was step 1, a
   * button and a failed check). Now each gate is one row: its state, its facts
   * in a line, and its one action. The first gate still to clear is "next".
   */
  const firstBlocked =
    checks.find((check) => !check.pass)?.id ?? (auctionCreated ? null : "auction_created");
  const stepByKey = new Map(steps.map((step) => [step.key, step]));
  const factOf = (id: string): string => {
    switch (id) {
      case "intake_closed":
        return regStats === undefined
          ? checkDetail({ id, detail: "" }, view.competition.status)
          : `${String(regStats.approved)} approved${pending > 0 ? ` · ${String(pending)} still waiting` : ""}${
              stepByKey.get(id)?.detail !== undefined &&
              stepByKey.get(id)?.detail !== null &&
              pending > 0
                ? " — approve or decline them, then close. The pool locks when you do."
                : view.competition.status === "registration_closed"
                  ? " · the pool is locked"
                  : ""
            }`;
      case "teams_present":
        return `${String(view.teams.length)} team${view.teams.length === 1 ? "" : "s"} · ${
          view.teams.length >= 2
            ? "each gets an owner and a paddle on the night"
            : "at least two are needed"
        }`;
      case "pool_present":
        return `${String(auction?.feasibility.poolSize ?? 0)} players in the pool`;
      default:
        return "";
    }
  };
  const TITLE: Record<string, string> = {
    intake_closed: "Close registration",
    teams_present: "Teams",
    pool_present: "Players in the pool",
  };
  const rowState = (pass: boolean, id: string): RowState =>
    pass ? "pass" : id === firstBlocked ? "next" : "later";
  const checkRows =
    auction === null ? null : (
      <ol className="rd-list" data-testid="readiness-sections">
        {checks.map((check) => {
          const step = stepByKey.get(check.id);
          return (
            <CheckRow
              key={check.id}
              testId={`check-${check.id}`}
              state={rowState(check.pass, check.id)}
              title={TITLE[check.id] ?? check.label}
              detail={factOf(check.id) || checkDetail(check, view.competition.status)}
              {...(check.pass
                ? check.id === "teams_present"
                  ? { fix: { href: `${base}/teams`, label: "Teams" } }
                  : {}
                : { fix: step?.action ?? fixOf(check.id, base) })}
            />
          );
        })}
        <CheckRow
          testId="check-squads_fillable"
          state={auction.feasibility.ok ? "pass" : "warn"}
          title="Pool against squads"
          detail={
            auction.feasibility.ok
              ? auction.feasibility.headline
              : `${String(auction.feasibility.shortfall)} short — ${String(auction.feasibility.poolSize)} players for ${String(auction.feasibility.needed)} squad places`
          }
          {...(short !== null
            ? {
                // The row's facts already say the count; the note says only the ways out.
                note: short.body.slice(short.body.indexOf("). ") + 3),
                fix: { href: `${base}/auction`, label: "Auction setup" },
              }
            : {})}
        />
        <CheckRow
          testId="check-auction_created"
          state={auctionCreated ? "pass" : rowState(false, "auction_created")}
          title={auctionCreated ? "The auction exists" : "Create the auction"}
          detail={
            auctionLive
              ? "Live now"
              : auctionCreated
                ? "Created — invite the owners, then open the room"
                : "Set the purse and squad size, then invite the owners"
          }
          {...(auctionCreated
            ? { fix: { href: `${base}/auction`, label: "Auction setup" } }
            : { fix: { href: `${base}/auction`, label: "Create the auction" } })}
        />
      </ol>
    );

  if (auctionOver) {
    const sold = auction?.view?.lotStats.sold ?? 0;
    const unsold = auction?.view?.lotStats.unsold ?? 0;
    const facts = [
      view.competition.name,
      sold + unsold > 0 ? `${String(sold)} of ${String(sold + unsold)} sold` : null,
      fixtureCount === 0
        ? "fixtures come next"
        : played + liveMatches > 0
          ? `the season is on — ${String(played)} of ${String(fixtureCount)} matches played${liveMatches > 0 ? `, ${String(liveMatches)} live` : ""}`
          : `${String(published)} of ${String(fixtureCount)} matches published`,
    ].filter((part): part is string => part !== null);
    return (
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* AFTER THE HAMMER THE PAGE STEPS ASIDE: it said "next is the match
              schedule" on a season three matches in. */}
          <section
            className="rd-after"
            data-testid="readiness-card"
            aria-labelledby="rd-after-title"
          >
            <span className="rd-after-mark" aria-hidden>
              <IconCheck size={22} />
            </span>
            <div className="rd-after-text">
              <Pill tone="green" dot testId="readiness-verdict">
                Auction completed
              </Pill>
              <h2 id="rd-after-title">Auction night is behind you</h2>
              <p data-testid="readiness-fixtures">{facts.join(" · ")}</p>
            </div>
            <div className="rd-after-go">
              <ButtonLink
                href={fixtureCount === 0 ? `${base}/fixtures` : base}
                size="touch"
                data-testid="readiness-next"
              >
                {fixtureCount === 0 ? "Build fixtures" : "Season overview"}
              </ButtonLink>
              <ButtonLink href={`${base}/auction`} variant="secondary" size="touch">
                Auction results
              </ButtonLink>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <section
          className="rd-verdict"
          data-tone={auctionLive ? "done" : steps.length === 0 ? "ready" : "todo"}
          aria-labelledby="rd-verdict-title"
          data-testid="readiness-card"
        >
          <div className="rd-verdict-head">
            <div className="rd-verdict-text">
              <Pill tone={verdictPill.tone} dot testId="readiness-verdict">
                {verdictPill.label}
              </Pill>
              <h2 id="rd-verdict-title">{title}</h2>
              <p>
                {`${view.competition.name} · ${String(auction?.feasibility.poolSize ?? 0)} players in the pool · ${String(view.teams.length)} team${view.teams.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <ButtonLink href={primary.href} size="touch" data-testid="readiness-next">
              {primary.label}
            </ButtonLink>
          </div>
          {checkRows ?? (
            <p className="st-note">Sign-in lacks access to this season&apos;s auction view.</p>
          )}
        </section>
        <p className="rd-after-line" data-testid="readiness-fixtures">
          {fixtureCount > 0
            ? `Fixtures: ${String(published)} of ${String(fixtureCount)} published${conflicts > 0 ? ` · ${String(conflicts)} conflict${conflicts === 1 ? "" : "s"}` : ""}${activeGrounds > 0 ? ` · ${String(activeGrounds)} ground${activeGrounds === 1 ? "" : "s"}` : ""} — `
            : "After the auction: grounds and fixtures — "}
          {org !== null ? <Link href={`/org/${org.slug}/venues`}>Venues</Link> : null}
          {org !== null ? " · " : null}
          <Link href={`${base}/fixtures`}>Fixtures</Link>
        </p>
      </div>
    </main>
  );
}

type RowState = "pass" | "next" | "later" | "warn";

// What a screen reader hears. A gate not yet cleared is "Blocked" whether it
// is the next one or a later one — the auction cannot open past either (and
// the organizer journey asserts the word).
const CHECK_WORD: Record<RowState, string> = {
  pass: "Pass: ",
  next: "Blocked: ",
  later: "Blocked: ",
  warn: "Warning: ",
};

/** One check: a mark whose shape says the state, the words, and its fix. */
function CheckRow({
  testId,
  state,
  title,
  detail,
  note,
  fix,
}: {
  testId: string;
  state: RowState;
  title: string;
  detail: string | null;
  /** A consequence said under the facts (the shortfall's ways out). */
  note?: string;
  fix?: { href: string; label: string };
}) {
  return (
    <li data-pass={state === "pass"} data-state={state} data-testid={testId}>
      <span className="rd-mark" aria-hidden>
        {state === "pass" ? (
          <IconCheck size={14} />
        ) : state === "warn" ? (
          <IconAlert size={14} />
        ) : null}
      </span>
      <span className="rd-text">
        <strong>{title}</strong>
        <span className="st-note">
          <span className="st-sr">{CHECK_WORD[state]}</span>
          {detail}
        </span>
        {note !== undefined ? <span className="rd-note">{note}</span> : null}
      </span>
      {fix !== undefined ? (
        <Link className="st-link" href={fix.href}>
          {fix.label}
        </Link>
      ) : (
        <span />
      )}
    </li>
  );
}
