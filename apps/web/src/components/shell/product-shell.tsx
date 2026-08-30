"use client";

import {
  AppShell,
  Breadcrumb,
  Drawer,
  IconBell,
  IconChevronDown,
  IconHelp,
  IconHome,
  IconMenu,
  IconRupee,
  IconTrophy,
  IconUsers,
  InlineSearch,
  LiveShell,
  PopoverMenu,
  PublicShell,
  SubNavTabs,
  type InlineSearchHandle,
  type PaletteGroup,
  type PublicShellLink,
  type ShellNavItem,
} from "@desiauction/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { recordRecentCompetition } from "../../app/home/home-shortcuts";
import { LEGAL_IDENTITY, legalIdentityPublished } from "../../content/company";
import { inboxSeenKey } from "../../lib/inbox-events";
import { NewsletterForm } from "../../components/marketing/newsletter-form";
import { formatPhone } from "../../lib/format-phone";
import { track } from "../../lib/telemetry";
import { BrandMark } from "./brand";
import {
  ADMIN_TABS,
  PUBLIC_DESTINATIONS,
  RAIL,
  activeAdminTab,
  activeCompetitionTab,
  activeOrgMoneyTab,
  activeRailKey,
  competitionTabs,
  liveExit,
  orgMoneyTabs,
  pageIdentity,
  shellKind,
} from "./nav";
import { ShellActionContext } from "./page-action";
import { ShellStatusContext } from "./page-status";
import { ShellTitleContext, type ShellTitleOverride } from "./page-title";
import { ThemeToggle } from "./theme-toggle";
import "./product-shell.css";

export interface ShellSession {
  name: string | null;
  phone: string;
  /**
   * Who is signed in. The bell's unread watermark is namespaced by it — one
   * origin-global key meant that on a shared handset, person A reading their
   * inbox marked person B's unread approval as already read. See
   * `inboxSeenKey` in lib/inbox-events.
   */
  personId: string;
}

export interface ShellOrg {
  slug: string;
  name: string;
  /** PX-8: holder of `finops.view` on this org — gates the Finance destinations. */
  canFinance?: boolean;
  /** Holder of `settlement.view` — a DIFFERENT capability partition from
      `canFinance`, though the two share one tab strip. */
  canSettle?: boolean;
}

export interface ShellCompetition {
  slug: string;
  name: string;
  orgName: string;
  orgSlug: string;
  /** PX-7: holder of `settlement.view` on this competition's org — gates Money. */
  canSettle: boolean;
}

export interface ProductShellProps {
  session: ShellSession | null;
  orgs: ShellOrg[];
  competitions: ShellCompetition[];
  /**
   * The page's primary action as the SERVER rendered it, delivered by the
   * `@action` parallel route (see app/layout.tsx). Present in the first paint,
   * which is the whole point — the context channel below can only deliver one
   * after hydration, and the bar changing height at that moment was CLS 0.123.
   */
  serverAction?: ReactNode;
  /** PX-9: holder of `platform.admin` — reveals the one door into administration. */
  isAdmin?: boolean;
  /** Newest person-scoped event timestamp (ISO) — drives the bell's unread dot. */
  latestEventAt?: string | null;
  /** The existing logout server action, passed through from the server layout. */
  logout: () => Promise<void>;
  children: ReactNode;
}

/** Bell with unread dot: newest event vs. the device's last inbox visit. */
function BellLink({
  latestEventAt,
  pathname,
  personId,
}: {
  latestEventAt: string | null;
  pathname: string;
  /** Namespaces the watermark. Without it the bell reads whoever last used
      this device, which on a shared handset is the wrong person. */
  personId: string;
}) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (latestEventAt === null) {
      setUnread(false);
      return;
    }
    const seen = window.localStorage.getItem(inboxSeenKey(personId));
    setUnread(seen === null || latestEventAt > seen);
  }, [latestEventAt, pathname, personId]);
  return (
    <Link
      className="shell-icon-button shell-bell"
      href="/inbox"
      aria-label={unread ? "Notifications — new activity" : "Notifications"}
      data-testid="shell-bell"
      data-unread={unread}
    >
      <IconBell />
      {unread ? <span className="shell-bell-dot" aria-hidden /> : null}
    </Link>
  );
}

const RAIL_ICONS: Record<string, ReactNode> = {
  home: <IconHome />,
  tournaments: <IconTrophy />,
  orgs: <IconUsers />,
  money: <IconRupee />,
  help: <IconHelp />,
};

/**
 * The public header's five destinations, with the one you are already on marked
 * so the shell can render `aria-current="page"`.
 *
 * "Tournaments" used to sit between two feature names ("Features", "Pricing")
 * and read as a third — a thing the product has, rather than a place to go. The
 * verb makes it a destination: the public directory of published tournaments.
 *
 * Matching is EXACT. A prefix match would light "Browse tournaments" up on
 * /c/<slug> too, where the link no longer points at the page you are reading —
 * `aria-current="page"` means this page, not this neighbourhood.
 */
/**
 * WHO IS OFFERING THIS SERVICE — in the footer of every public page.
 *
 * The identity was published in one place only: the bottom of the Legal Centre,
 * which is two navigations from anywhere a visitor actually stands. A footer
 * that names no company is the single loudest "this might not be a real
 * business" signal a site can send, and for an India-facing platform it is also
 * the thing the rules ask for by name (Companies Act s.12(3)(c) for the CIN,
 * Consumer Protection (E-Commerce) Rules 4(3) for the legal name and principal
 * address — see `content/company.ts`).
 *
 * Renders NOTHING while the identity is unpublished. Not a blank, not a
 * placeholder, and never a guess: an invented company name in a footer is the
 * worst line this product could print.
 */
function OperatorIdentity(): ReactNode {
  if (!legalIdentityPublished()) {
    return null;
  }
  const id = LEGAL_IDENTITY;
  return (
    <p>
      <span>{id.legalName}</span>
      {id.registrationNumber !== null ? <span>CIN {id.registrationNumber}</span> : null}
      {id.gstin !== null ? <span>GSTIN {id.gstin}</span> : null}
      {id.registeredAddress !== null ? <span>{id.registeredAddress}</span> : null}
      {id.grievanceOfficerName !== null ? (
        <span>Grievance Officer: {id.grievanceOfficerName}</span>
      ) : null}
    </p>
  );
}

function publicNav(pathname: string): PublicShellLink[] {
  const mark = (link: PublicShellLink): PublicShellLink =>
    link.href === pathname ? { ...link, active: true } : link;
  return [
    { label: "Features", href: "/features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Browse tournaments", href: "/c" },
    {
      label: "Resources",
      href: "/help",
      children: [
        // Three of the six slots went to /blog, /case-studies and /api-docs —
        // honest placeholder pages, all of them, each answering the click with
        // "nothing published yet". Retired here for the same reason they were
        // retired from the footer: a menu is a set of recommendations, and this
        // one recommended three empty rooms over the route to a human. The
        // pages remain live and findable in /search.
        { label: "Help centre", href: "/help" },
        { label: "Rules & guidelines", href: "/rules-guidelines" },
        { label: "Support", href: "/support" },
        { label: "Legal", href: "/legal" },
      ].map(mark),
    },
    { label: "About", href: "/about" },
  ].map(mark);
}

/** The design system has no gear glyph; the utility group needs one. */
function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={20} height={20} aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.6-2-3.5-2.4 1a7.9 7.9 0 0 0-1.7-1L15 3H9l-.4 2.9a7.9 7.9 0 0 0-1.7 1l-2.4-1-2 3.5L4.6 11a7.9 7.9 0 0 0 0 2l-2 1.6 2 3.5 2.4-1a7.9 7.9 0 0 0 1.7 1L9 21h6l.4-2.9a7.9 7.9 0 0 0 1.7-1l2.4 1 2-3.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The shell router (PX-2): one client component picks Public/Console/Live/bare
 * chrome from the pathname via the shared nav model. No page opts in or out —
 * chrome is decided in exactly one place.
 */
export function ProductShell({
  session,
  orgs,
  competitions,
  serverAction,
  isAdmin = false,
  latestEventAt = null,
  logout,
  children,
}: ProductShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [titleOverride, setTitleOverride] = useState<ShellTitleOverride | null>(null);
  /**
   * The action a page PUBLISHES, which is now an override rather than the only
   * source. `serverAction` (the `@action` parallel route) is what the server
   * rendered, so the bar has its button at first paint; this channel exists for
   * the one surface whose action follows client state — /tournaments swaps
   * "New tournament" for "New season" when the view toggles — and it wins when
   * it holds something.
   *
   * Null, not undefined, is meaningful: `retract` returns it to null and the
   * server's action takes the slot back rather than the bar going empty.
   */
  const [publishedAction, setPublishedAction] = useState<ReactNode | null>(null);
  const pageAction = publishedAction ?? serverAction ?? null;
  // The Live shell's status strip, published by the page that owns the socket.
  const [liveStatus, setLiveStatus] = useState<ReactNode | null>(null);
  const searchRef = useRef<InlineSearchHandle | null>(null);
  const kind = shellKind(pathname);

  // ⌘K / Ctrl-K reaches the same field the icon opens — one search, two doors.
  useEffect(() => {
    if (kind !== "console" || session === null) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [kind, session]);

  // Close transient chrome on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Stable identities, so a page's effect fires once. `retract` clears only
  // what the retracting instance itself published, which keeps a Suspense
  // re-reveal (or a route change) from wiping the live page's header.
  const titleChannel = useMemo(
    () => ({
      publish: setTitleOverride,
      retract: (token: ShellTitleOverride) => {
        setTitleOverride((current) => (current === token ? null : current));
      },
    }),
    [],
  );
  const actionChannel = useMemo(
    () => ({
      publish: setPublishedAction,
      retract: (token: ReactNode) => {
        setPublishedAction((current) => (current === token ? null : current));
      },
    }),
    [],
  );
  const statusChannel = useMemo(
    () => ({
      publish: setLiveStatus,
      retract: (token: ReactNode) => {
        setLiveStatus((current) => (current === token ? null : current));
      },
    }),
    [],
  );

  // "Continue working" feed: remember competition visits (device-local only).
  useEffect(() => {
    const match = /^\/seasons\/([^/]+)/.exec(pathname);
    if (match !== null && session !== null) {
      recordRecentCompetition(match[1] as string);
    }
  }, [pathname, session]);

  const paletteGroups: PaletteGroup[] = useMemo(() => {
    const groups: PaletteGroup[] = [
      {
        label: "Go to",
        items: [
          ...RAIL.map((item) => ({ key: item.key, label: item.label, href: item.href })),
          { key: "account", label: "Account", href: "/account" },
          { key: "inbox", label: "Notifications", href: "/inbox" },
          {
            key: "directory",
            label: "Browse public tournaments",
            href: "/c",
            keywords: "directory discover register public",
          },
        ],
      },
    ];
    // PX-4 organizer search: inside a competition, its sections are first-class
    // destinations (teams, registrations, fixtures, readiness, auction).
    const current = /^\/seasons\/([^/]+)/.exec(pathname);
    const currentCompetition =
      current !== null ? competitions.find((entry) => entry.slug === current[1]) : undefined;
    if (currentCompetition !== undefined) {
      groups.push({
        label: `In ${currentCompetition.name}`,
        items: [
          ...competitionTabs(currentCompetition.slug, currentCompetition.canSettle).map((tab) => ({
            key: `section-${tab.key}`,
            label: tab.label,
            hint: currentCompetition.name,
            href: tab.href,
            ...(tab.key === "money"
              ? {
                  keywords: "settlement case dues obligations collect payment waive close evidence",
                }
              : {}),
          })),
          {
            key: "section-readiness",
            label: "Readiness",
            hint: currentCompetition.name,
            href: `/seasons/${currentCompetition.slug}/readiness`,
            keywords: "ready auction blockers checklist",
          },
          // PX-6: auction-night destinations (players, lots and history live
          // inside these surfaces; the palette is the navigator).
          ...[
            {
              key: "live",
              label: "Live room",
              path: "auction/live",
              keywords: "bid paddle lots players",
            },
            {
              key: "cockpit",
              label: "Cockpit",
              path: "auction/cockpit",
              keywords: "conduct gavel queue lots",
            },
            {
              key: "spectate",
              label: "Spectate",
              path: "auction/spectate",
              keywords: "watch stage big screen",
            },
            {
              key: "ledger",
              label: "Auction ledger",
              path: "auction/ledger",
              keywords: "history bids audit",
            },
            { key: "replay", label: "Replay", path: "auction/replay", keywords: "history rewatch" },
          ].map((entry) => ({
            key: `section-${entry.key}`,
            label: entry.label,
            hint: currentCompetition.name,
            href: `/seasons/${currentCompetition.slug}/${entry.path}`,
            keywords: entry.keywords,
          })),
          // PX-7: the settlement destinations. Cases, teams, payment references
          // and evidence all live INSIDE these two surfaces — the palette is the
          // navigator, and the case review's own tabs are addressable, so a
          // search lands on the section rather than a page to hunt through.
          ...(currentCompetition.canSettle
            ? [
                {
                  key: "section-case-review",
                  label: "Case review",
                  hint: currentCompetition.name,
                  href: `/seasons/${currentCompetition.slug}/money`,
                  keywords: "settlement case obligations timeline audit verification",
                },
                {
                  key: "section-payments",
                  label: "Payments",
                  hint: currentCompetition.name,
                  href: `/seasons/${currentCompetition.slug}/money`,
                  keywords: "payment reference collect capture attest refund receipt cash upi bank",
                },
                {
                  key: "section-evidence",
                  label: "Closure evidence",
                  hint: currentCompetition.name,
                  href: `/seasons/${currentCompetition.slug}/money`,
                  keywords: "evidence digest replay reconciled closure sealed proof",
                },
              ]
            : []),
        ],
      });
    }
    if (competitions.length > 0) {
      groups.push({
        label: "Seasons",
        items: competitions.map((competition) => ({
          key: `competition-${competition.slug}`,
          label: competition.name,
          hint: competition.orgName,
          href: `/seasons/${competition.slug}`,
        })),
      });
    }
    // PX-7: every competition whose books this person may see is reachable as a
    // settlement destination by name, from anywhere.
    const settleable = competitions.filter((competition) => competition.canSettle);
    if (settleable.length > 0) {
      groups.push({
        label: "Settlement",
        items: [
          ...settleable.map((competition) => ({
            key: `settlement-${competition.slug}`,
            label: `${competition.name} — settlement`,
            hint: competition.orgName,
            href: `/seasons/${competition.slug}/money`,
            keywords: "money case dues obligations collect waive close evidence reconciled",
          })),
          ...[...new Set(settleable.map((competition) => competition.orgSlug))].map((orgSlug) => ({
            key: `settlement-desk-${orgSlug}`,
            label: `${competitions.find((entry) => entry.orgSlug === orgSlug)?.orgName ?? orgSlug} — settlement desk`,
            href: `/org/${orgSlug}/settlement`,
            keywords: "dashboard worklist cases outstanding collected today attention",
          })),
        ],
      });
    }
    if (orgs.length > 0) {
      groups.push({
        label: "Organizations",
        items: orgs.map((org) => ({
          key: `org-${org.slug}`,
          label: org.name,
          href: `/org/${org.slug}`,
        })),
      });
    }
    // PX-8: the finance destinations, for orgs whose books this person may see.
    const financeOrgs = orgs.filter((org) => org.canFinance === true);
    if (financeOrgs.length > 0) {
      groups.push({
        label: "Finance",
        items: financeOrgs.flatMap((org) => [
          {
            key: `finance-${org.slug}`,
            label: `${org.name} — finance`,
            href: `/org/${org.slug}/money`,
            keywords:
              "financial operations documents receipts invoices transactions register health exceptions attention",
          },
          {
            key: `finance-deliveries-${org.slug}`,
            label: `${org.name} — deliveries`,
            href: `/org/${org.slug}/money/deliveries`,
            keywords: "dispatch delivery queued processing succeeded failed retry dead letter",
          },
          {
            key: `finance-reconciliation-${org.slug}`,
            label: `${org.name} — reconciliation`,
            href: `/org/${org.slug}/money/reconciliation`,
            keywords: "reconcile matched pending certification evidence audit ingest follower",
          },
        ]),
      });
    }
    if (orgs.length > 0) {
      groups.push({
        label: "Venues",
        items: orgs.map((org) => ({
          key: `venues-${org.slug}`,
          label: `${org.name} venues`,
          href: `/org/${org.slug}/venues`,
          keywords: "grounds venue availability",
        })),
      });
    }
    // PX-9 §6: Command Search reaches administration's surfaces. Still
    // NAVIGATION ONLY (PX-2's ruling) — these are the five admin routes, which
    // gate themselves. The cross-platform record search (orgs, users, cases,
    // documents by name) lives on /admin/orgs, /admin/users and /admin/audit,
    // where it can query the system pool behind the gate; shipping every org
    // and person into every admin's client bundle to filter them here would
    // leak the platform's directory into the browser to save a click.
    if (isAdmin) {
      groups.push({
        label: "Administration",
        items: ADMIN_TABS.map((tab) => ({
          key: `admin-${tab.key}`,
          label: tab.key === "overview" ? "Platform admin" : `Platform ${tab.label.toLowerCase()}`,
          href: tab.href,
          keywords: "admin platform staff governance support observe",
        })),
      });
    }
    // PX-10 §6: help, legal, pricing, support and release notes reachable from
    // the palette — navigation only, for everyone (they are all public routes).
    groups.push({
      label: "Help & product",
      items: PUBLIC_DESTINATIONS.map((destination) => ({
        key: `public-${destination.key}`,
        label: destination.label,
        href: destination.href,
        keywords: destination.keywords,
      })),
    });
    return groups;
  }, [competitions, orgs, pathname, isAdmin]);

  if (kind === "bare") {
    return <>{children}</>;
  }

  if (kind === "live") {
    const exit = liveExit(pathname, session !== null);
    return (
      // The live surfaces own the viewport, so the header strip is all the
      // chrome they get: the one door out, the mark, and — now that a page can
      // publish it (`PageStatus`) — the status ribbon, instead of a second copy
      // of the auction's name inside the page's own content.
      <ShellStatusContext.Provider value={statusChannel}>
        <LiveShell
          exitHref={exit.href}
          exitLabel={exit.label}
          linkComponent={Link}
          brand={<BrandMark size={26} />}
          // A spectator arrives with no account and the mark was dead text on
          // the one screen the product is most often shared from.
          brandHref="/"
          {...(liveStatus !== null ? { statusSlot: liveStatus } : {})}
        >
          {children}
        </LiveShell>
      </ShellStatusContext.Provider>
    );
  }

  if (kind === "public" || session === null) {
    // The gate is a conversion surface: it keeps the header (an escape hatch
    // back into the site) but not the sitemap footer, and not the two header
    // controls that point at the page you are already reading.
    // The invitation landings are gates too, and the most transactional pages
    // in the product: one card, one decision. They were serving the full
    // five-column sitemap footer, which at 390px was HALF the page under a
    // single 300px card. Same compact treatment as /login.
    const atGate =
      pathname === "/login" || pathname.startsWith("/join/") || pathname.startsWith("/owner-join/");
    // …but only /login takes the fill treatment (it is a floodlight surface;
    // see the login polish note). The invitation cards stay on daylight.
    const atLoginGate = pathname === "/login";
    return (
      <PublicShell
        wordmark="DesiAuction"
        wordmarkHref="/"
        glyph={<BrandMark size={30} />}
        nav={publicNav(pathname)}
        headerAction={
          session !== null ? (
            <Link className="shell-header-cta" href="/home">
              Open console
            </Link>
          ) : atGate ? null : (
            <>
              <Link className="shell-header-link" href="/login">
                Sign in
              </Link>
              <Link className="shell-header-cta shell-desktop-only" href="/login">
                Start your auction
              </Link>
            </>
          )
        }
        footerCompact={atGate}
        contentFill={atLoginGate}
        // The public footer (PX-1 01 §3). Every link is a real route (the PX-2
        // no-dead-links ruling) — and, since 2026-08-29, a route with something
        // on it. Four destinations left: /blog, /case-studies, /api-docs and
        // /careers are honest placeholders that say "nothing published yet",
        // and the footer was promoting four of them from the bottom of every
        // public page. A no-dead-links rule is not satisfied by a link that
        // resolves to an apology; a visitor who takes one learns the company
        // has no writing, no customers and no API. The pages stay live, stay in
        // the sitemap and stay findable in /search — they are simply no longer
        // advertised. They come back the day they have content.
        //
        // What replaced them is what a visitor at the bottom of the page is
        // actually looking for: the way in (start an auction, book a demo), the
        // way to a human (help, FAQ, support, contact), and the way to check we
        // are real (about, legal, and the operator identity below).
        footerGroups={[
          {
            label: "Product",
            links: [
              { label: "Features", href: "/features" },
              { label: "How it works", href: "/#how" },
              { label: "Pricing", href: "/pricing" },
              { label: "Security", href: "/security" },
              { label: "Release notes", href: "/releases" },
            ],
          },
          {
            label: "Tournaments",
            links: [
              { label: "Browse tournaments", href: "/c" },
              // Labelled for what the link DOES, not where it lands: creating a
              // tournament begins at the phone gate, and "Create tournament"
              // pointing at /login read as a broken link to anyone who noticed.
              { label: "Start your auction", href: "/login" },
              { label: "Rules & guidelines", href: "/rules-guidelines" },
              { label: "Book a demo", href: "/schedule-demo" },
            ],
          },
          {
            label: "Support",
            links: [
              { label: "Help centre", href: "/help" },
              { label: "FAQ", href: "/help/faq" },
              { label: "Contact support", href: "/support" },
              { label: "Search the site", href: "/search" },
            ],
          },
          {
            label: "Company",
            links: [
              { label: "About us", href: "/about" },
              { label: "Contact us", href: "/contact" },
              { label: "Legal centre", href: "/legal" },
              { label: "Grievance redressal", href: "/legal/grievances" },
            ],
          },
        ]}
        footerTagline="Live player auctions for Indian tournaments — server-verified bidding, settled to the rupee."
        footerNewsletter={<NewsletterForm />}
        // The copyright belongs to the entity, not the product name: the
        // company signing this footer is Eventztree, and it is named here for
        // the same reason it is named in the identity block below.
        footerNote={`© 2026 ${LEGAL_IDENTITY.tradingName ?? "DesiAuction"} — a product of ${
          LEGAL_IDENTITY.legalName ?? "our team"
        }. In beta.`}
        footerLegal={<OperatorIdentity />}
        footerBottomLinks={
          atGate
            ? [
                { label: "Privacy", href: "/legal/privacy" },
                { label: "Terms", href: "/legal/terms" },
                { label: "Support", href: "/support" },
              ]
            : [
                { label: "Privacy Policy", href: "/legal/privacy" },
                // "Terms of Use" named a document titled "Terms of Service".
                // The label now matches what the page says it is.
                { label: "Terms of Service", href: "/legal/terms" },
                { label: "Refund Policy", href: "/legal/refunds" },
                { label: "Code of Conduct", href: "/legal/code-of-conduct" },
              ]
        }
        linkComponent={Link}
      >
        {children}
      </PublicShell>
    );
  }

  const activeKey = activeRailKey(pathname);
  const nav: ShellNavItem[] = RAIL.map((item) => ({
    ...item,
    icon: RAIL_ICONS[item.key],
    active: item.key === activeKey,
  }));

  // Identity: one derivation for every console route (nav.ts), overridden only
  // where the name is page data the shell cannot hold.
  const identity = pageIdentity(pathname, { competitions, orgs, isAdmin });
  const title = titleOverride === null ? identity.title : titleOverride.title;
  const titleTestId = titleOverride?.testId;
  const subtitle = titleOverride?.subtitle ?? identity.subtitle;

  // Section tabs: seasons, the org's money desks, administration. A surface
  // without sections renders no strip rather than an empty one.
  let tabsNode: ReactNode = null;
  const competitionMatch = /^\/seasons\/([^/]+)/.exec(pathname);
  const orgMatch = /^\/org\/([^/]+)/.exec(pathname);
  let seasonSwitcherFor: string | null = null;
  if (pathname.startsWith("/admin")) {
    // Rendered on `isAdmin` alone: for anyone else the page underneath is a
    // 404, so chrome would frame nothing.
    tabsNode = isAdmin ? (
      <SubNavTabs
        label="Administration sections"
        linkComponent={Link}
        tabs={ADMIN_TABS.map((tab) => ({
          ...tab,
          active: tab.key === activeAdminTab(pathname),
        }))}
      />
    ) : null;
  } else if (competitionMatch !== null) {
    const slug = competitionMatch[1] as string;
    const competition = competitions.find((entry) => entry.slug === slug);
    if (competition !== undefined) {
      seasonSwitcherFor = slug;
      const activeTab = activeCompetitionTab(pathname, slug);
      tabsNode = (
        <SubNavTabs
          label="Season sections"
          linkComponent={Link}
          tabs={competitionTabs(slug, competition.canSettle).map((tab) => ({
            ...tab,
            active: tab.key === activeTab,
          }))}
        />
      );
    }
  } else if (orgMatch !== null) {
    const slug = orgMatch[1] as string;
    const activeDesk = activeOrgMoneyTab(pathname, slug);
    const org = orgs.find((entry) => entry.slug === slug) ?? null;
    /*
     * Build the strip from the capabilities actually held, not from membership.
     *
     * The four desks span TWO capability partitions — Settlement is gated by
     * `settlement.view`, the three Finance desks by `finops.view` — and neither
     * is implied by owning the organization. Gating the strip on membership
     * meant a person with no money authority landed on "This page doesn't
     * exist" underneath a working tab bar offering Settlement · Finance ·
     * Deliveries · Reconciliation, all four of which 404 for them. The pages
     * themselves take great care to be indistinguishable from nothing; the
     * chrome around them was announcing exactly what it was hiding.
     *
     * An empty list renders no strip at all, so the 404 is bare.
     */
    const desks = orgMoneyTabs(slug).filter((tab) =>
      tab.key === "settlement" ? org?.canSettle === true : org?.canFinance === true,
    );
    if (activeDesk !== null && desks.length > 0) {
      tabsNode = (
        <SubNavTabs
          label="Money operations"
          linkComponent={Link}
          tabs={desks.map((tab) => ({ ...tab, active: tab.key === activeDesk }))}
        />
      );
    }
  }
  const initials =
    session.name !== null && session.name.trim() !== ""
      ? session.name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join("")
      : "•";

  return (
    <ShellTitleContext.Provider value={titleChannel}>
      <ShellActionContext.Provider value={actionChannel}>
        <AppShell
          nav={nav}
          navGroups={[
            {
              key: "utility",
              items: [
                {
                  key: "inbox",
                  label: "Notifications",
                  href: "/inbox",
                  icon: <IconBell />,
                  active: pathname.startsWith("/inbox"),
                },
                {
                  key: "account",
                  label: "Account",
                  href: "/account",
                  icon: <IconSettings />,
                  active: pathname.startsWith("/account"),
                },
              ],
            },
          ]}
          linkComponent={Link}
          wordmark="DesiAuction"
          wordmarkHref="/home"
          glyph={<BrandMark size={32} />}
          tagline="Bid · Build · Win"
          {...(title !== null ? { pageTitle: title } : {})}
          {...(titleTestId !== undefined ? { pageTitleAttrs: { "data-testid": titleTestId } } : {})}
          {...(identity.crumbs.length > 0
            ? {
                breadcrumb: <Breadcrumb trail linkComponent={Link} items={identity.crumbs} />,
              }
            : subtitle !== undefined
              ? { subtitle }
              : {})}
          {...(tabsNode !== null ? { tabs: tabsNode } : {})}
          {...(pageAction !== null ? { pageAction } : {})}
          railFooter={
            <Link className="shell-railuser" href="/account">
              <span className="shell-railuser-avatar">{initials}</span>
              <span className="shell-railuser-text">
                <strong>{session.name ?? formatPhone(session.phone)}</strong>
                <span>Organizer</span>
              </span>
            </Link>
          }
          topActions={
            <>
              <InlineSearch
                handleRef={searchRef}
                groups={paletteGroups}
                onNavigate={(href) => {
                  router.push(href);
                }}
              />
              <span className="shell-desktop-only">
                <ThemeToggle />
              </span>
              <BellLink
                latestEventAt={latestEventAt}
                pathname={pathname}
                personId={session.personId}
              />
              {/* Switchers live with the other controls now — one cluster, in the
                same place, whether you are switching season or organization. */}
              {seasonSwitcherFor !== null && competitions.length > 1 ? (
                <span className="shell-desktop-only">
                  <PopoverMenu
                    label="Switch season"
                    trigger={
                      <>
                        <span className="shell-org-name">Switch</span>
                        <IconChevronDown width={16} height={16} />
                      </>
                    }
                    items={competitions
                      .filter((entry) => entry.slug !== seasonSwitcherFor)
                      .map((entry) => ({
                        key: entry.slug,
                        label: `${entry.name} — ${entry.orgName}`,
                        onSelect: () => {
                          router.push(`/seasons/${entry.slug}`);
                        },
                      }))}
                  />
                </span>
              ) : null}
              {seasonSwitcherFor === null && orgs.length > 1 ? (
                <span className="shell-desktop-only">
                  <PopoverMenu
                    label="Switch organization"
                    trigger={
                      <>
                        <span className="shell-org-name">{orgs[0]?.name ?? "Organizations"}</span>
                        <IconChevronDown width={16} height={16} />
                      </>
                    }
                    items={orgs.map((org) => ({
                      key: org.slug,
                      label: org.name,
                      onSelect: () => {
                        track("org.switched");
                        router.push(`/org/${org.slug}`);
                      },
                    }))}
                  />
                </span>
              ) : null}
              <span className="shell-desktop-only">
                <PopoverMenu
                  label="Account menu"
                  trigger={<span className="shell-avatar">{initials}</span>}
                  header={
                    <span data-testid="shell-session-phone">{formatPhone(session.phone)}</span>
                  }
                  items={[
                    {
                      key: "account",
                      label: "Account",
                      onSelect: () => {
                        router.push("/account");
                      },
                    },
                    {
                      key: "help",
                      label: "Help",
                      onSelect: () => {
                        router.push("/help");
                      },
                    },
                    // PX-1 01 §3: "(Admin: + Platform admin.)" — absent, not
                    // disabled, for everyone else. The surface 404s regardless;
                    // this only spares admins from typing the URL.
                    ...(isAdmin
                      ? [
                          {
                            key: "admin",
                            label: "Platform admin",
                            onSelect: () => {
                              router.push("/admin");
                            },
                          },
                        ]
                      : []),
                    {
                      key: "logout",
                      label: "Sign out",
                      danger: true,
                      onSelect: () => {
                        track("auth.logout");
                        void logout();
                      },
                    },
                  ]}
                />
              </span>
              <button
                type="button"
                className="shell-icon-button shell-mobile-only"
                aria-label="Menu"
                onClick={() => {
                  setDrawerOpen(true);
                }}
              >
                <IconMenu />
              </button>
            </>
          }
        >
          {children}
        </AppShell>
        {/* Mounted only while open, as on the public shell. A closed <dialog>
            keeps its whole subtree in the DOM, and the Drawer titles itself
            with an <h2> — so an always-mounted menu left a level-2 heading in
            the markup of every console page, at every width, belonging to a
            panel nobody had opened. Assistive tech was never affected (a closed
            <dialog> is display:none, so it is absent from the a11y tree and
            from axe's outline); what does see it is anything reading the DOM
            blind to visibility — `locator("h2")`, `getByLabel` — the same noise
            that makes FormDialog's fields ambiguous. Nothing is lost by
            mounting late: the drawer keeps no state between openings, and
            Drawer's own effect calls showModal() on mount. */}
        {drawerOpen ? (
          <Drawer
            open
            onClose={() => {
              setDrawerOpen(false);
            }}
            title="Menu"
          >
            <div className="shell-drawer-session">{formatPhone(session.phone)}</div>
            <ul className="shell-drawer-list">
              {orgs.map((org) => (
                <li key={org.slug}>
                  <Link href={`/org/${org.slug}`} className="shell-drawer-link">
                    {org.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/account" className="shell-drawer-link">
                  Account
                </Link>
              </li>
              <li>
                <Link href="/help" className="shell-drawer-link">
                  Help
                </Link>
              </li>
              {isAdmin ? (
                <li>
                  <Link href="/admin" className="shell-drawer-link">
                    Platform admin
                  </Link>
                </li>
              ) : null}
              {/* The theme switch rides here under 720px: the bar has room for the
                title or a fourth icon, and the title is what people navigate by. */}
              <li className="shell-drawer-row">
                <span>Theme</span>
                <ThemeToggle />
              </li>
              <li>
                <button
                  type="button"
                  className="shell-drawer-link shell-drawer-danger"
                  onClick={() => void logout()}
                >
                  Sign out
                </button>
              </li>
            </ul>
          </Drawer>
        ) : null}
      </ShellActionContext.Provider>
    </ShellTitleContext.Provider>
  );
}
