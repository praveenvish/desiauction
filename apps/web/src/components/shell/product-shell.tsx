"use client";

import {
  AppShell,
  Breadcrumb,
  CommandPalette,
  ContextBar,
  Drawer,
  IconBell,
  IconChevronDown,
  IconHelp,
  IconHome,
  IconMenu,
  IconRupee,
  IconSearch,
  IconTrophy,
  IconUsers,
  LiveShell,
  PopoverMenu,
  PublicShell,
  SubNavTabs,
  type PaletteGroup,
  type ShellNavItem,
} from "@desiauction/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { recordRecentCompetition } from "../../app/home/home-shortcuts";
import { INBOX_SEEN_KEY } from "../../app/inbox/inbox-list";
import { NewsletterForm } from "../../components/marketing/newsletter-form";
import {
  IconCamera,
  IconGlobe,
  IconMessageCircle,
  IconPlay,
} from "../../components/marketing/icons";
import { track } from "../../lib/telemetry";
import {
  ADMIN_TABS,
  PUBLIC_DESTINATIONS,
  RAIL,
  activeAdminTab,
  activeCompetitionTab,
  activeRailKey,
  competitionTabs,
  liveExit,
  sectionLabel,
  shellKind,
} from "./nav";
import { ThemeToggle } from "./theme-toggle";
import "./product-shell.css";

export interface ShellSession {
  name: string | null;
  phone: string;
}

export interface ShellOrg {
  slug: string;
  name: string;
  /** PX-8: holder of `finops.view` on this org — gates the Finance destinations. */
  canFinance?: boolean;
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
  /** PX-9: holder of `platform.admin` — reveals the one door into administration. */
  isAdmin?: boolean;
  /** Newest person-scoped event timestamp (ISO) — drives the bell's unread dot. */
  latestEventAt?: string | null;
  /** The existing logout server action, passed through from the server layout. */
  logout: () => Promise<void>;
  children: ReactNode;
}

/** Bell with unread dot: newest event vs. the device's last inbox visit. */
function BellLink({ latestEventAt, pathname }: { latestEventAt: string | null; pathname: string }) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (latestEventAt === null) {
      setUnread(false);
      return;
    }
    const seen = window.localStorage.getItem(INBOX_SEEN_KEY);
    setUnread(seen === null || latestEventAt > seen);
  }, [latestEventAt, pathname]);
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
  competitions: <IconTrophy />,
  orgs: <IconUsers />,
  money: <IconRupee />,
  help: <IconHelp />,
};

/** Surface name shown at the left of the top bar for each rail destination. */
const RAIL_TITLES: Record<string, string> = {
  home: "Dashboard",
  competitions: "Competitions",
  orgs: "Organizations",
  money: "Money",
  help: "Help",
};

/** Titles for surfaces outside the five-item rail. Longest prefix wins. */
const SURFACE_TITLES: [string, string][] = [
  ["/auctions", "Auctions"],
  ["/teams", "Teams"],
  ["/players", "Players"],
  ["/registrations", "Registrations"],
  ["/fixtures", "Fixtures"],
  ["/inbox", "Notifications"],
  ["/account", "Settings"],
];

const box = { viewBox: "0 0 24 24", fill: "none", width: 20, height: 20, "aria-hidden": true };

function IconGavel() {
  return (
    <svg {...box}>
      <path
        d="M4 20 13 11M16 8l-3-3 4-1 3 3-1 4-3-3zM13 11l-3-3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg {...box}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 21a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconChecklist() {
  return (
    <svg {...box}>
      <path
        d="m9 11 3 3L22 4M21 12v7H3V5h12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg {...box}>
      <path
        d="M7 3v4M17 3v4M4 9h16M5 5h14v16H5z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  isAdmin = false,
  latestEventAt = null,
  logout,
  children,
}: ProductShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const kind = shellKind(pathname);

  // ⌘K / Ctrl-K opens the palette anywhere in the Console shell.
  useEffect(() => {
    if (kind !== "console" || session === null) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [kind, session]);

  // Close transient chrome on navigation.
  useEffect(() => {
    setPaletteOpen(false);
    setDrawerOpen(false);
  }, [pathname]);

  // "Continue working" feed: remember competition visits (device-local only).
  useEffect(() => {
    const match = /^\/competitions\/([^/]+)/.exec(pathname);
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
            label: "Browse public competitions",
            href: "/c",
            keywords: "directory discover register public",
          },
        ],
      },
    ];
    // PX-4 organizer search: inside a competition, its sections are first-class
    // destinations (teams, registrations, fixtures, readiness, auction).
    const current = /^\/competitions\/([^/]+)/.exec(pathname);
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
            href: `/competitions/${currentCompetition.slug}/readiness`,
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
            href: `/competitions/${currentCompetition.slug}/${entry.path}`,
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
                  href: `/competitions/${currentCompetition.slug}/money`,
                  keywords: "settlement case obligations timeline audit verification",
                },
                {
                  key: "section-payments",
                  label: "Payments",
                  hint: currentCompetition.name,
                  href: `/competitions/${currentCompetition.slug}/money`,
                  keywords: "payment reference collect capture attest refund receipt cash upi bank",
                },
                {
                  key: "section-evidence",
                  label: "Closure evidence",
                  hint: currentCompetition.name,
                  href: `/competitions/${currentCompetition.slug}/money`,
                  keywords: "evidence digest replay reconciled closure sealed proof",
                },
              ]
            : []),
        ],
      });
    }
    if (competitions.length > 0) {
      groups.push({
        label: "Competitions",
        items: competitions.map((competition) => ({
          key: `competition-${competition.slug}`,
          label: competition.name,
          hint: competition.orgName,
          href: `/competitions/${competition.slug}`,
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
            href: `/competitions/${competition.slug}/money`,
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
      <LiveShell exitHref={exit.href} exitLabel={exit.label} linkComponent={Link}>
        {children}
      </LiveShell>
    );
  }

  if (kind === "public" || session === null) {
    return (
      <PublicShell
        wordmark="DesiAuction"
        wordmarkHref="/"
        nav={[
          { label: "Features", href: "/features" },
          { label: "Pricing", href: "/pricing" },
          { label: "Competitions", href: "/c" },
          {
            label: "Resources",
            href: "/help",
            children: [
              { label: "Help center", href: "/help" },
              { label: "Blog", href: "/blog" },
              { label: "Case studies", href: "/case-studies" },
              { label: "API docs", href: "/api-docs" },
            ],
          },
          { label: "About", href: "/about" },
        ]}
        headerAction={
          session !== null ? (
            <Link className="shell-header-cta" href="/home">
              Open console
            </Link>
          ) : (
            <>
              <Link className="shell-header-link" href="/login">
                Sign in
              </Link>
              <Link className="shell-header-cta shell-desktop-only" href="/login">
                Run your auction
              </Link>
            </>
          )
        }
        // PX-10: the complete public footer (PX-1 01 §3) — only routes that
        // exist (the PX-2 no-dead-links ruling), all shipped in this milestone.
        footerGroups={[
          {
            label: "Product",
            links: [
              { label: "Features", href: "/features" },
              { label: "How it works", href: "/#how" },
              { label: "Pricing", href: "/pricing" },
              { label: "Security", href: "/security" },
            ],
          },
          {
            label: "Tournaments",
            links: [
              { label: "All competitions", href: "/c" },
              { label: "Create tournament", href: "/login" },
              { label: "Rules & guidelines", href: "/rules-guidelines" },
              { label: "Schedule demo", href: "/schedule-demo" },
            ],
          },
          {
            label: "Resources",
            links: [
              { label: "Help center", href: "/help" },
              { label: "Blog", href: "/blog" },
              { label: "Case studies", href: "/case-studies" },
              { label: "API docs", href: "/api-docs" },
            ],
          },
          {
            label: "Company",
            links: [
              { label: "About us", href: "/about" },
              { label: "Careers", href: "/careers" },
              { label: "Contact us", href: "/contact" },
              { label: "Legal", href: "/legal" },
            ],
          },
        ]}
        footerTagline="The most trusted platform to run live player auctions for tournaments across India."
        footerSocial={
          <>
            <IconCamera />
            <IconPlay />
            <IconMessageCircle />
            <IconGlobe />
          </>
        }
        footerNewsletter={<NewsletterForm />}
        footerNote="© 2026 DesiAuction — in beta. Tournament auctions, taken seriously."
        footerBottomLinks={[
          { label: "Privacy Policy", href: "/legal/privacy" },
          { label: "Terms of Use", href: "/legal/terms" },
          { label: "Refund Policy", href: "/legal/refunds" },
        ]}
        linkComponent={Link}
      >
        {children}
      </PublicShell>
    );
  }

  const activeKey = activeRailKey(pathname);
  const railTitle =
    (activeKey !== null ? RAIL_TITLES[activeKey] : undefined) ??
    SURFACE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1];
  const nav: ShellNavItem[] = RAIL.map((item) => ({
    ...item,
    icon: RAIL_ICONS[item.key],
    active: item.key === activeKey,
  }));

  // Context header: competition pages get breadcrumb + tabs + switcher; org
  // pages get a breadcrumb. Data comes from the layout's existing reads —
  // an unknown slug (non-member deep link) simply renders no context bar.
  let contextBarNode: ReactNode = null;
  const competitionMatch = /^\/competitions\/([^/]+)/.exec(pathname);
  const orgMatch = /^\/org\/([^/]+)/.exec(pathname);
  if (pathname.startsWith("/admin")) {
    // Administration's own context bar. Rendered on `isAdmin` alone: for anyone
    // else the page underneath is a 404, so chrome would frame nothing.
    const section = sectionLabel(pathname);
    contextBarNode = isAdmin ? (
      <ContextBar
        breadcrumb={
          <Breadcrumb
            linkComponent={Link}
            items={[
              { label: "Platform admin", ...(section !== null ? { href: "/admin" } : {}) },
              ...(section !== null ? [{ label: section }] : []),
            ]}
          />
        }
        tabs={
          <SubNavTabs
            label="Administration sections"
            linkComponent={Link}
            tabs={ADMIN_TABS.map((tab) => ({
              ...tab,
              active: tab.key === activeAdminTab(pathname),
            }))}
          />
        }
      />
    ) : null;
  } else if (competitionMatch !== null) {
    const slug = competitionMatch[1] as string;
    const competition = competitions.find((entry) => entry.slug === slug);
    if (competition !== undefined) {
      const section = sectionLabel(pathname);
      const activeTab = activeCompetitionTab(pathname, slug);
      contextBarNode = (
        <ContextBar
          breadcrumb={
            <Breadcrumb
              linkComponent={Link}
              items={[
                { label: competition.orgName, href: "/orgs" },
                {
                  label: competition.name,
                  ...(section !== null ? { href: `/competitions/${slug}` } : {}),
                },
                ...(section !== null ? [{ label: section }] : []),
              ]}
            />
          }
          actions={
            competitions.length > 1 ? (
              <PopoverMenu
                label="Switch competition"
                trigger={
                  <>
                    <span className="shell-org-name">Switch</span>
                    <IconChevronDown width={16} height={16} />
                  </>
                }
                items={competitions
                  .filter((entry) => entry.slug !== slug)
                  .map((entry) => ({
                    key: entry.slug,
                    label: `${entry.name} — ${entry.orgName}`,
                    onSelect: () => {
                      router.push(`/competitions/${entry.slug}`);
                    },
                  }))}
              />
            ) : undefined
          }
          tabs={
            <SubNavTabs
              label="Competition sections"
              linkComponent={Link}
              tabs={competitionTabs(slug, competition.canSettle).map((tab) => ({
                ...tab,
                active: tab.key === activeTab,
              }))}
            />
          }
        />
      );
    }
  } else if (orgMatch !== null) {
    const slug = orgMatch[1] as string;
    const org = orgs.find((entry) => entry.slug === slug);
    if (org !== undefined) {
      contextBarNode = (
        <ContextBar
          breadcrumb={
            <Breadcrumb
              linkComponent={Link}
              items={[
                { label: "Organizations", href: "/orgs" },
                {
                  label: org.name,
                  ...(pathname.includes("/venues") ? { href: `/org/${slug}` } : {}),
                },
                ...(pathname.includes("/venues") ? [{ label: "Venues" }] : []),
              ]}
            />
          }
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
    <>
      <AppShell
        nav={nav}
        navGroups={[
          {
            key: "workspace",
            label: "Workspace",
            items: [
              {
                key: "auctions",
                label: "Auctions",
                href: "/auctions",
                icon: <IconGavel />,
                active: pathname.startsWith("/auctions"),
              },
              {
                key: "teams",
                label: "Teams",
                href: "/teams",
                icon: <IconUsers />,
                active: pathname.startsWith("/teams"),
              },
              {
                key: "players",
                label: "Players",
                href: "/players",
                icon: <IconPerson />,
                active: pathname.startsWith("/players"),
              },
              {
                key: "registrations",
                label: "Registrations",
                href: "/registrations",
                icon: <IconChecklist />,
                active: pathname.startsWith("/registrations"),
              },
              {
                key: "fixtures",
                label: "Fixtures",
                href: "/fixtures",
                icon: <IconCalendar />,
                active: pathname.startsWith("/fixtures"),
              },
            ],
          },
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
                label: "Settings",
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
        tagline="Bid · Build · Win"
        {...(contextBarNode === null && railTitle !== undefined ? { pageTitle: railTitle } : {})}
        contextBar={contextBarNode}
        search={
          <button
            type="button"
            className="shell-search"
            aria-label="Go to anything (⌘K)"
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            <IconSearch />
            <span className="shell-search-text">Search competitions, teams, players…</span>
            <span className="shell-search-kbd">⌘K</span>
          </button>
        }
        railFooter={
          <>
            <div className="shell-pro">
              <span className="shell-pro-cup" aria-hidden>
                <IconTrophy />
              </span>
              <strong>Upgrade to Pro</strong>
              <p>Unlock advanced features and detailed analytics.</p>
              <Link className="shell-pro-cta" href="/pricing">
                See plans
              </Link>
            </div>
            <Link className="shell-railuser" href="/account">
              <span className="shell-railuser-avatar">{initials}</span>
              <span className="shell-railuser-text">
                <strong>{session.name ?? session.phone}</strong>
                <span>Organizer</span>
              </span>
            </Link>
          </>
        }
        topActions={
          <>
            <button
              type="button"
              className="shell-icon-button shell-mobile-only"
              aria-label="Go to anything (⌘K)"
              onClick={() => {
                setPaletteOpen(true);
              }}
            >
              <IconSearch />
            </button>
            <ThemeToggle />
            <BellLink latestEventAt={latestEventAt} pathname={pathname} />
            {orgs.length > 1 ? (
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
                header={<span data-testid="shell-session-phone">{session.phone}</span>}
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
      <Drawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
        }}
        title="Menu"
      >
        <div className="shell-drawer-session">{session.phone}</div>
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
        groups={paletteGroups}
        onNavigate={(href) => {
          router.push(href);
        }}
      />
    </>
  );
}
