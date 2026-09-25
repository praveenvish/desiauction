"use client";

import {
  AppShell,
  Breadcrumb,
  Drawer,
  IconBell,
  IconArrowRight,
  IconBolt,
  IconCalendar,
  IconChart,
  IconGavel,
  IconGrid,
  IconGlobe,
  IconShieldCheck,
  IconStar,
  IconChevronDown,
  IconHelp,
  IconHome,
  IconMenu,
  IconRupee,
  IconSearch,
  IconTrophy,
  IconUser,
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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { recordRecentCompetition } from "../../app/home/home-shortcuts";
import { LEGAL_IDENTITY, legalIdentityPublished } from "../../content/company";
import { inboxSeenKey } from "../../lib/inbox-events";
import { NewsletterForm } from "../../components/marketing/newsletter-form";
import { personContact, personLabel } from "../../lib/person-label";
import { track } from "../../lib/telemetry";
import { BrandMark, BrandWordmark } from "./brand";
import {
  adminSectionsFor,
  PUBLIC_DESTINATIONS,
  activeAdminTab,
  activeOrgMoneyTab,
  activeSeasonTab,
  seasonTabs,
  liveExit,
  navigationFor,
  phoneBar,
  orgMoneyTabs,
  pageIdentity,
  shellKind,
  type NavIcon,
  type NavItem,
  type NavRoles,
  type SeasonRole,
} from "./nav";
import { useReportProblem } from "../report-problem/report-problem";
import { ShellActionContext } from "./page-action";
import { ShellStatusContext } from "./page-status";
import { ShellTitleContext, type ShellTitleOverride } from "./page-title";
import { ThemeToggle } from "./theme-toggle";
import "./product-shell.css";
import "./console.css";

export interface ShellSession {
  name: string | null;
  /** Nullable since 0062 — an email-anchored account has no phone. */
  phone: string | null;
  email: string | null;
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
  /**
   * Who this person is IN THIS SEASON (RN-1 Phase 4), resolved by
   * `seasonRoleFor` in the server layout. Replaces `canManage`, which was one
   * boolean standing in for seven roles.
   */
  seasonRole: SeasonRole;
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
  /**
   * What this person does here (server/roles), in the menu's vocabulary.
   *
   * REPLACES `isAdmin` + `roles`. The old pair was the two-authorities defect
   * in miniature: a boolean that revealed administration only to
   * `platform.admin`, beside a role object the rail consulted for exactly one
   * decision. One input, one function, one menu.
   */
  navRoles?: NavRoles | null;
  /** Newest person-scoped event timestamp (ISO) — drives the bell's unread dot. */
  latestEventAt?: string | null;
  /** The existing logout server action, passed through from the server layout. */
  logout: () => Promise<void>;
  children: ReactNode;
}

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
  };
}

/** The device's inbox watermark for this person; undefined when storage is unreadable. */
function readInboxSeen(personId: string): string | null | undefined {
  try {
    return window.localStorage.getItem(inboxSeenKey(personId));
  } catch {
    return undefined;
  }
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
  // The watermark is read from storage on every render (useSyncExternalStore
  // re-reads its snapshot each time), so leaving /inbox — which has just moved
  // it — shows the new answer at once. Another tab reading the inbox clears
  // this tab's dot through `storage`. Undefined means "not known yet": the
  // server render and the hydrating one show no dot rather than guess.
  const seen = useSyncExternalStore(
    subscribeToStorage,
    () => readInboxSeen(personId),
    () => undefined,
  );
  const unread =
    latestEventAt !== null &&
    // Standing ON the notifications page, the answer is already "you are
    // reading them" — the page advances the watermark as it renders, so the dot
    // must not stay lit over the very list it was pointing at.
    !pathname.startsWith("/inbox") &&
    seen !== undefined &&
    (seen === null || latestEventAt > seen);
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

/**
 * The menu's icon vocabulary (nav.ts `NavIcon`), in one map.
 *
 * Was TWO maps — `ROLE_ICONS` for the role groups and `RAIL_ICONS` for the rail
 * — which is the three-lists defect showing up in the iconography: the same
 * destination could be drawn differently depending on which list it landed in.
 *
 * `org` is a grid and `team` is people, deliberately: both were `IconUsers`,
 * so an organizer who also owned a team saw the same glyph twice in one rail.
 */
const NAV_ICONS: Record<NavIcon, ReactNode> = {
  home: <IconHome />,
  room: <IconGavel />,
  cockpit: <IconBolt />,
  team: <IconUsers />,
  nights: <IconCalendar />,
  trophy: <IconTrophy />,
  org: <IconGrid />,
  money: <IconRupee />,
  sports: <IconStar />,
  // The founder's mockup icons for the three cross-season indexes
  // (ui/premium-flow, 2026-09-19): a person, a gavel, a chart.
  player: <IconUser />,
  gavel: <IconGavel />,
  chart: <IconChart />,
  find: <IconGlobe />,
  help: <IconHelp />,
  bell: <IconBell />,
  account: <IconSettings />,
  admin: <IconShieldCheck />,
};

/**
 * Reachable by anyone signed in, whether or not it is in their menu.
 *
 * Every one of these is a place a person with no roles at all may legitimately
 * want: `/orgs` is where a club is created, and the directory is where a
 * tournament is found. They are search answers, not offers — see the note in
 * the palette below.
 */
const UNIVERSAL_DESTINATIONS: { key: string; label: string; href: string; keywords: string }[] = [
  {
    key: "go-orgs",
    label: "Organizations",
    href: "/orgs",
    keywords: "organization org club create start academy",
  },
  {
    key: "go-directory",
    label: "Browse public tournaments",
    href: "/c",
    keywords: "directory discover register public tournament find",
  },
];

/** nav.ts NavItem → the shell's presentational item. */
function toShellItem(item: NavItem): ShellNavItem {
  return {
    key: item.key,
    label: item.label,
    shortLabel: item.shortLabel,
    href: item.href,
    icon: NAV_ICONS[item.icon],
    ...(item.active === true ? { active: true } : {}),
    ...(item.live === true ? { live: true } : {}),
    ...(item.choices !== undefined
      ? {
          children: item.choices.map((choice) => ({
            key: choice.key,
            label: choice.label,
            href: choice.href,
            ...(choice.live === true ? { live: true } : {}),
          })),
        }
      : {}),
  };
}

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
    { label: "Browse tournaments", href: "/c" },
    { label: "Pricing", href: "/pricing" },
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
        { label: "About us", href: "/about" },
      ].map(mark),
    },
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
  navRoles = null,
  latestEventAt = null,
  logout,
  children,
}: ProductShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  // The drawer remembers WHERE it was opened, so it is open only on that page:
  // navigating anywhere closes it in the same render, with no effect needed to
  // notice the route changed.
  const [drawerOpenOn, setDrawerOpenOn] = useState<string | null>(null);
  const drawerOpen = drawerOpenOn === pathname;
  const reportProblem = useReportProblem();
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

  /*
   * THE MENU (RN-1). One call, one model, both devices — `AppShell` maps `nav`
   * into the desktop rail AND the phone's bottom bar, so LAW 4 holds by
   * construction rather than by two lists being kept in step by hand.
   */
  const menu = useMemo(() => navigationFor({ roles: navRoles, pathname }), [navRoles, pathname]);
  /** An operator holds a door — any platform capability, not just admin. */
  const adminDoor = menu.utility.find((item) => item.key === "admin")?.href;
  const isAdmin = adminDoor !== undefined;

  const paletteGroups: PaletteGroup[] = useMemo(() => {
    const groups: PaletteGroup[] = [
      {
        label: "Go to",
        /*
         * The person's own menu FIRST, then the handful of places anyone
         * signed in may legitimately go.
         *
         * It used to be the fixed four-item `RAIL` plus Account, Notifications
         * and the directory, so ⌘K never offered a team owner their own team.
         * Building it from the menu fixed that and broke something else: a
         * brand-new account typing "organiz" found nothing at all, though
         * creating a club is exactly what they are there to do.
         *
         * LAW 3 GOVERNS WHAT THE PRODUCT OFFERS UNPROMPTED. A rail item is an
         * offer and its slots are scarce, so it must be earned. A search result
         * answers a question somebody asked, and refusing to answer is not
         * restraint — it is a dead end. The two lists differ on purpose.
         */
        items: [
          ...[...menu.rail, ...menu.utility].map((item) => ({
            key: item.key,
            label: item.label,
            href: item.href,
          })),
          ...UNIVERSAL_DESTINATIONS.filter(
            (destination) =>
              ![...menu.rail, ...menu.utility].some((item) => item.href === destination.href),
          ),
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
          ...seasonTabs(currentCompetition.slug, currentCompetition.seasonRole, {
            canSettle: currentCompetition.canSettle,
          }).map((tab) => ({
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
    const adminSections = adminSectionsFor(navRoles?.platform ?? []);
    if (adminSections.length > 0) {
      groups.push({
        label: "Administration",
        items: adminSections.map((section) => ({
          key: `admin-${section.key}`,
          label:
            section.key === "overview"
              ? "Platform admin"
              : `Platform ${section.label.toLowerCase()}`,
          href: section.href,
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
  }, [competitions, orgs, pathname, navRoles, menu]);

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
          brand={<BrandMark size={32} />}
          wordmark={<BrandWordmark tone="live" />}
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
      pathname === "/login" ||
      pathname.startsWith("/join/") ||
      pathname.startsWith("/owner-join/") ||
      pathname.startsWith("/review/");
    // …but only /login takes the fill treatment (it is a floodlight surface;
    // see the login polish note). The invitation cards stay on daylight.
    const atLoginGate = pathname === "/login";
    return (
      <PublicShell
        // The brand lockup is ONE component with a tone (brand.tsx), not markup
        // repeated per shell — which is how the header came to render the
        // wordmark and the tagline jammed on a single line: the inline copy
        // kept a <small> the stacking CSS no longer had a rule for.
        wordmark={<BrandWordmark tone="header" />}
        wordmarkHref="/"
        glyph={<BrandMark size={42} />}
        nav={publicNav(pathname)}
        {...(!atGate
          ? {
              mobileAction:
                session !== null
                  ? { label: "Open console", href: "/home" }
                  : { label: "Create your tournament", href: "/login" },
            }
          : {})}
        headerAction={
          <>
            {/* Search and the theme switch are the two controls a visitor
                looks for in a header and had to go to the footer to find.
                They are hidden at the gates, where the page holds a single
                decision and every other control is a way to not make it.
                The search label is "Search", not "Search the site" — the
                footer already owns that name, and two links with one name
                break the strict-mode locators that name it. */}
            {atGate ? null : (
              <>
                {/* Desktop only, for now: at 320px the header action row was
                    4 controls wide and pushed the page 4px past the viewport
                    (responsive.spec). The phone reaches search through the
                    footer's "Search the site"; giving the mobile menu both
                    controls is a change to the shared shell, not to this
                    header, and belongs in its own pass. */}
                <Link
                  className="shell-icon-button shell-desktop-only"
                  href="/search"
                  aria-label="Search"
                  title="Search"
                >
                  <IconSearch width={18} height={18} />
                </Link>
                <span className="shell-desktop-only">
                  <ThemeToggle />
                </span>
              </>
            )}
            {session !== null ? (
              <Link className="shell-header-cta" href="/home">
                Open console
              </Link>
            ) : atGate ? null : (
              <>
                <Link className="shell-header-link" href="/login">
                  Sign in
                </Link>
                <Link className="shell-header-cta shell-desktop-only" href="/login">
                  Start free <IconArrowRight width={16} height={16} />
                </Link>
              </>
            )}
          </>
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
        // way to a human (help, FAQ, support), and the way to check we are real
        // (about, legal, and the operator identity below).
        //
        // "Contact us" is gone: /contact now redirects to /support, which the
        // Support column already links as "Contact support" — two footer links
        // to one page. Both demos sit under Product, and the self-serve one
        // uses the homepage's own name for it, "Try a mock auction".
        footerGroups={[
          {
            label: "Product",
            links: [
              { label: "Features", href: "/features" },
              { label: "Try a mock auction", href: "/#playground" },
              { label: "Book a demo", href: "/schedule-demo" },
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
              { label: "Create a tournament", href: "/login" },
              { label: "Rules & guidelines", href: "/rules-guidelines" },
            ],
          },
          {
            label: "Support",
            links: [
              { label: "Help centre", href: "/help" },
              { label: "FAQ", href: "/help/faq" },
              { label: "Contact support", href: "/support" },
              // Opens the report dialog over THIS page (the provider intercepts
              // the hash), so the screenshot is of what they were looking at.
              { label: "Report a problem", href: "#report-a-problem" },
              { label: "Search the site", href: "/search" },
            ],
          },
          {
            label: "Company",
            links: [
              { label: "About us", href: "/about" },
              { label: "Legal centre", href: "/legal" },
              { label: "Grievance redressal", href: "/legal/grievances" },
            ],
          },
        ]}
        footerHeading={
          <>
            Every sport.
            <br />
            <span>One community.</span>
          </>
        }
        footerTagline="Bring your players together. Build your teams. Make your next tournament one to remember."
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

  const nav: ShellNavItem[] = menu.rail.map(toShellItem);
  /*
   * The phone's bar is the same menu minus the desk surfaces (`mobile: false`)
   * and capped at the five columns it has. The rail above is vertical and keeps
   * everything, which is what the founder's 2026-09-19 mockups assumed when
   * they asked for seven items on a laptop.
   */
  const bottomNav: ShellNavItem[] = phoneBar(menu.rail).map(toShellItem);

  // Identity: one derivation for every console route (nav.ts), overridden only
  // where the name is page data the shell cannot hold.
  const identity = pageIdentity(pathname, {
    competitions,
    orgs,
    isAdmin,
    // Their own door, so the trail never points at a page that 404s for them.
    ...(adminDoor !== undefined ? { adminHome: adminDoor } : {}),
  });
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
    // Only the sections this operator holds a key to (RN-1 Phase 5). The pages
    // still 404 on a direct URL for anyone else — that is the real boundary.
    const sections = adminSectionsFor(navRoles?.platform ?? []);
    tabsNode =
      sections.length > 0 ? (
        <SubNavTabs
          label="Administration sections"
          linkComponent={Link}
          tabs={sections.map((section) => ({
            ...section,
            active: section.key === activeAdminTab(pathname),
          }))}
        />
      ) : null;
  } else if (competitionMatch !== null) {
    const slug = competitionMatch[1] as string;
    const competition = competitions.find((entry) => entry.slug === slug);
    if (competition !== undefined) {
      seasonSwitcherFor = slug;
      const tabs = seasonTabs(slug, competition.seasonRole, {
        canSettle: competition.canSettle,
      });
      const activeTab = activeSeasonTab(pathname, slug, tabs);
      tabsNode = (
        <SubNavTabs
          label="Season sections"
          linkComponent={Link}
          tabs={tabs.map((tab) => ({ ...tab, active: tab.key === activeTab }))}
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
          bottomNav={bottomNav}
          navGroups={[
            {
              key: "utility",
              // LAW 1: the rail above is the ONE primary list. This is
              // services — notifications, the account, help, and an operator's
              // door — divided from it and never competing with it. The role
              // groups that used to sit between them are gone: their items are
              // in the rail itself now, which is also what finally puts them on
              // the phone, since the bottom bar maps `nav` and never mapped
              // `navGroups`.
              items: menu.utility.map(toShellItem),
            },
          ]}
          linkComponent={Link}
          wordmark={<BrandWordmark tone="rail" />}
          wordmarkHref="/home"
          glyph={<BrandMark size={32} />}
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
                <strong>{personLabel(session)}</strong>
                {/* The second line used to hardcode "Organizer" — a role claim
                    the shell cannot know and stamped on every member, viewer
                    and player alike. The CONTACT is the identity fact that is
                    always true — phone or email, one of the two is guaranteed
                    by `people_reachable_check` — and on the shared handsets
                    this product targets it says WHICH account is signed in. */}
                {session.name !== null ? <span data-private>{personContact(session)}</span> : null}
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
                    <span data-testid="shell-session-phone" data-private>
                      {personContact(session)}
                    </span>
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
                    {
                      key: "report-problem",
                      label: "Report a problem",
                      onSelect: reportProblem,
                    },
                    /*
                     * PX-1 01 §3: "(Admin: + Platform admin.)" — absent, not
                     * disabled, for everyone else. The surface 404s regardless;
                     * this only spares an operator from typing the URL.
                     *
                     * The destination comes from the MENU, so a support-only
                     * operator lands on /admin/reports rather than on /admin,
                     * which 404s for them. It used to be hardcoded to /admin
                     * for a door that only `platform.admin` could see at all.
                     */
                    ...menu.utility
                      .filter((item) => item.key === "admin")
                      .map((item) => ({
                        key: item.key,
                        label: item.label,
                        onSelect: () => {
                          router.push(item.href);
                        },
                      })),
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
                  setDrawerOpenOn(pathname);
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
              setDrawerOpenOn(null);
            }}
            title="Menu"
          >
            <div className="shell-drawer-session" data-private>
              {personContact(session)}
            </div>
            {/*
                UTILITY ONLY (RN-1 §3.3). The primary menu is the bottom tab
                bar, which maps the same `nav` as the desktop rail; this is the
                services half, in the same order as the rail's utility group
                because it is built from the same list.

                It used to open with every club you BELONG to — a membership
                list standing in for a menu, on the one device where it was the
                only menu there was. Organizations is a rail item for the people
                who run clubs, and nothing for the people who do not.
            */}
            <ul className="shell-drawer-list">
              {menu.utility.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="shell-drawer-link">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="shell-drawer-link"
                  onClick={() => {
                    // Close the drawer first: the screenshot is of the page,
                    // not of the menu that was covering it.
                    setDrawerOpenOn(null);
                    reportProblem();
                  }}
                >
                  Report a problem
                </button>
              </li>

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
