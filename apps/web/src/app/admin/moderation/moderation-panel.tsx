"use client";

import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconExternal,
  IconEyeOff,
  IconGlobe,
  Pager,
  Pill,
  SectionCard,
  SegmentedTabs,
  Toolbar,
  ToolbarCount,
  ToolbarSearch,
  ToolbarSpacer,
  useToast,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  liftSeasonHoldAction,
  takeDownSeason,
  type ModerationResult,
} from "../../../server/admin/moderation-actions";
import type {
  HeldSeasonRow,
  ModerationDesk,
  ModerationFilter,
  PublicSeasonRow,
} from "../../../server/admin/moderation-views";
import { AdminFilterForm } from "../admin-filter-form";
import { RelativeTime } from "../admin-ui";
import { entryState } from "./moderation-model";
import { formatDate } from "../../../lib/format-date";

const REASON_MIN = 10;
const REASON_MAX = 500;

/**
 * Taking a page down, and giving it back.
 *
 * Each public season links to the page itself, so the desk judges what a
 * stranger actually sees. Taking one down sits behind a dialog that says
 * exactly what disappears and what does not, and will not submit without a
 * reason the organizer is going to read.
 */
const FILTERS: readonly { key: ModerationFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "recent", label: "Public this week" },
  { key: "open", label: "Registration open" },
];

function deskHref(query: string, filter: ModerationFilter, after?: string): string {
  const params = new URLSearchParams();
  if (query !== "") params.set("q", query);
  if (filter !== "all") params.set("filter", filter);
  if (after !== undefined) params.set("after", after);
  const qs = params.toString();
  return qs === "" ? "/admin/moderation" : `/admin/moderation?${qs}`;
}

export function ModerationPanel({
  desk,
  paged = false,
}: {
  desk: ModerationDesk;
  paged?: boolean;
}) {
  return (
    <>
      {/* The desk in three figures. An empty "Taken down" card used to lead
          the page — ~160px saying nothing. */}
      <dl className="mod-figures" data-testid="moderation-figures">
        <div>
          <dd>{desk.publicAll.toLocaleString("en-IN")}</dd>
          <dt>seasons on the public web</dt>
        </div>
        <div>
          <dd data-zero={desk.publicRecent === 0 || undefined}>
            {desk.publicRecent.toLocaleString("en-IN")}
          </dd>
          <dt>went public this week</dt>
        </div>
        <div>
          <dd data-zero={desk.held.length === 0 || undefined}>{desk.held.length}</dd>
          <dt>taken down by DesiAuction</dt>
        </div>
      </dl>
      {desk.held.length === 0 ? (
        <p className="mod-none" data-testid="moderation-held">
          <IconEyeOff size={16} aria-hidden />
          <span>
            <strong>Nothing is taken down.</strong> A season DesiAuction takes off the public web is
            listed here, with who took it down and why.
          </span>
        </p>
      ) : (
        <SectionCard
          icon={<IconEyeOff />}
          tone="red"
          title={`Taken down · ${String(desk.held.length)}`}
          description="Off the public web until DesiAuction lifts the hold"
          flush
          data-testid="moderation-held"
        >
          <ul className="admin-rows is-stacked">
            {desk.held.map((row) => (
              <HeldRow key={row.id} row={row} />
            ))}
          </ul>
        </SectionCard>
      )}
      <SectionCard
        icon={<IconGlobe />}
        tone="neutral"
        title="On the public web"
        description="Every season a stranger can open — judge the page, not the people"
        flush
        data-testid="moderation-public"
      >
        <AdminFilterForm testId="moderation-search">
          <Toolbar>
            <ToolbarSearch
              id="moderation-q"
              name="q"
              label="Find a public season"
              placeholder="Season, slug or club"
              defaultValue={desk.query}
              submitLabel="Search"
            />
            <SegmentedTabs
              label="Public seasons"
              items={FILTERS.map((option) => ({
                key: option.key,
                label: option.label,
                count: desk.counts[option.key].toLocaleString("en-IN"),
                active: option.key === desk.filter,
                href: deskHref(desk.query, option.key),
              }))}
            />
            {desk.filter !== "all" ? (
              <input type="hidden" name="filter" value={desk.filter} />
            ) : null}
            <ToolbarSpacer />
            <ToolbarCount testId="moderation-count">
              {desk.published.length < desk.publishedTotal
                ? `${String(desk.published.length)} of ${String(desk.publishedTotal)}`
                : String(desk.publishedTotal)}{" "}
              {desk.query === "" ? "public" : "matching"}
            </ToolbarCount>
          </Toolbar>
        </AdminFilterForm>
        {desk.published.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title={desk.query === "" ? "No season is public" : "No public season matches"}
              description={
                desk.query === ""
                  ? "When an organizer publishes a season, it appears here."
                  : "Try the club's name, or part of the season's."
              }
            />
          </div>
        ) : (
          <>
            <ul className="admin-rows admin-mod-rows">
              {desk.published.map((row) => (
                <PublicRow key={row.id} row={row} />
              ))}
            </ul>
            {desk.nextCursor !== null || paged ? (
              <div className="admin-pagination">
                {/* The other 108 used to be reachable only by searching. */}
                <Pager
                  label="Public seasons"
                  total={desk.publishedTotal}
                  shown={desk.published.length}
                  noun="public seasons · newest first"
                  firstHref={paged ? deskHref(desk.query, desk.filter) : null}
                  nextHref={
                    desk.nextCursor === null
                      ? null
                      : deskHref(desk.query, desk.filter, desk.nextCursor)
                  }
                  linkComponent={Link}
                  nextTestId="moderation-next"
                />
              </div>
            ) : null}
          </>
        )}
      </SectionCard>
    </>
  );
}

function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (act: () => Promise<ModerationResult>, onDone: () => void) => {
    start(async () => {
      const result = await act();
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.message, tone: "success" });
      onDone();
      router.refresh();
    });
  };
  return { pending, run };
}

function PublicRow({ row }: { row: PublicSeasonRow }) {
  const entry = entryState(row.status);
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const valid = length >= REASON_MIN && length <= REASON_MAX;
  return (
    <li className="pass-row mod-row" data-testid={`moderation-public-${row.slug}`}>
      <span className="admin-mod-main">
        <span className="pass-row-season">{row.name}</span>
        <span className="admin-meta">
          <Link href={`/admin/orgs/${row.orgSlug}`} className="admin-quiet-link">
            {row.orgName}
          </Link>
          <span aria-hidden> · </span>
          <span className="admin-sport">{row.sport}</span>
          <span aria-hidden> · </span>
          {/* When it reached strangers, from the audit log; a season
              published before that was recorded says "created" instead. */}
          {row.publicSince === null ? "created " : "public "}
          <RelativeTime at={row.publicSince ?? row.createdAt} />
          {/* A phone has no room beside the doors: the count joins this line. */}
          <span className="mod-phone-only">
            {" "}
            · {row.registered.toLocaleString("en-IN")} registered
          </span>
        </span>
      </span>
      {/* What decides how far a page reaches: can strangers register right
          now, and how many already have. */}
      <span className="mod-reach">
        <Pill tone={entry.tone}>{entry.label}</Pill>
        <span className="admin-meta">{row.registered.toLocaleString("en-IN")} registered</span>
      </span>
      <div className="pass-row-actions">
        <a
          className="mod-open"
          href={`/c/${row.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open the public page of ${row.name} (opens in a new tab)`}
          data-testid={`moderation-view-${row.slug}`}
        >
          <IconExternal size={16} aria-hidden />
          <span aria-hidden>Open the page</span>
        </a>
        {/* Fifty solid red buttons were a column of alarm. The row's button is
            quiet; the dialog it opens is where the danger is said and done. */}
        <button
          type="button"
          className="admin-quiet-danger"
          onClick={() => {
            setReason("");
            setOpen(true);
          }}
          data-testid={`take-down-${row.slug}`}
        >
          <IconEyeOff size={16} />
          <span className="admin-quiet-label">Take down…</span>
        </button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={`Take down ${row.name}?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={!valid}
              onClick={() => {
                run(
                  () => takeDownSeason(row.slug, reason),
                  () => {
                    setOpen(false);
                  },
                );
              }}
              data-testid="take-down-confirm"
            >
              Take the page down
            </Button>
          </>
        }
      >
        <p>
          The public page, its player pages and share cards, and its directory and search listings
          go at once. The organizer cannot publish it again until the hold is lifted. Nothing is
          deleted: the club&rsquo;s season, registrations and auction carry on untouched.
        </p>
        <Field
          label="Reason"
          name={`take-down-reason-${row.id}`}
          value={reason}
          required
          maxLength={REASON_MAX}
          autoComplete="off"
          help={`The organizer reads this on their season. ${String(REASON_MIN)}–${String(REASON_MAX)} characters.`}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </Dialog>
    </li>
  );
}

function HeldRow({ row }: { row: HeldSeasonRow }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="pass-row" data-testid={`moderation-held-${row.slug}`}>
      <div className="pass-row-head">
        <span className="pass-row-season">{row.name}</span>
        <Pill tone="red" dot>
          Taken down
        </Pill>
      </div>
      <p className="pass-row-sub">
        <Link href={`/admin/orgs/${row.orgSlug}`} className="admin-inline-link">
          {row.orgName}
        </Link>{" "}
        · {formatDate(row.heldAt)}
        {row.heldByName === null ? "" : ` · by ${row.heldByName}`}
      </p>
      <blockquote className="pass-row-note">{row.reason}</blockquote>
      <div className="pass-row-actions">
        <Button
          variant="secondary"
          onClick={() => {
            setNote("");
            setOpen(true);
          }}
          data-testid={`lift-hold-${row.slug}`}
        >
          Lift the hold…
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={`Lift the hold on ${row.name}?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() => {
                run(
                  () => liftSeasonHoldAction(row.slug, note),
                  () => {
                    setOpen(false);
                  },
                );
              }}
              data-testid="lift-hold-confirm"
            >
              Lift the hold
            </Button>
          </>
        }
      >
        <p>
          The organizer may publish the season again. Lifting does not republish it — it stays off
          the public web until they choose to.
        </p>
        <Field
          label="Note (optional)"
          name={`lift-note-${row.id}`}
          value={note}
          maxLength={REASON_MAX}
          autoComplete="off"
          help="Recorded on the audit log beside the lift."
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Dialog>
    </li>
  );
}
