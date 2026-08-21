// The full product surface, with real parameters resolved against the demo seed.
// `role` is who the sweep signs in as; `public` routes are also swept signed-out.
export const ORG = "demo-club";
export const LEAGUE = "demo-premier-league";
export const SETTLED = "demo-cup-settled";
export const PUBCOMP = "night-cup-10472893-1f35";
export const PUBPLAYER = "RJBN2EE";
export const PERSON = "01KY6XB0P4RW46S06NJA06K5EE";
export const CASE = "01KYA5PAJ56QY8AZ9H7MMHGFTW";
export const DOC = "01KYA5PANCWW7AGP0E7ZB1MVHA";
export const TOURNAMENT = "qa25-hollow-trophy-e3pg";

/** area: which part of the product; auth: needs a session. */
export const ROUTES = [
  // --- public / marketing -----------------------------------------------------
  { path: "/", area: "marketing", auth: false },
  { path: "/features", area: "marketing", auth: false },
  { path: "/pricing", area: "marketing", auth: false },
  { path: "/about", area: "marketing", auth: false },
  { path: "/careers", area: "marketing", auth: false },
  { path: "/contact", area: "marketing", auth: false },
  { path: "/security", area: "marketing", auth: false },
  { path: "/case-studies", area: "marketing", auth: false },
  { path: "/blog", area: "marketing", auth: false },
  { path: "/releases", area: "marketing", auth: false },
  { path: "/api-docs", area: "marketing", auth: false },
  { path: "/schedule-demo", area: "marketing", auth: false },
  { path: "/rules-guidelines", area: "marketing", auth: false },
  { path: "/support", area: "marketing", auth: false },
  { path: "/search", area: "marketing", auth: false },
  { path: "/search?q=auction", area: "marketing", auth: false },
  // --- help / legal -----------------------------------------------------------
  { path: "/help", area: "help", auth: false },
  { path: "/help/category/getting-started", area: "help", auth: false },
  { path: "/help/signing-in", area: "help", auth: false },
  { path: "/help/auction-night", area: "help", auth: false },
  { path: "/help/conducting-the-auction", area: "help", auth: false },
  { path: "/legal", area: "help", auth: false },
  { path: "/legal/terms", area: "help", auth: false },
  { path: "/legal/privacy", area: "help", auth: false },
  { path: "/legal/refunds", area: "help", auth: false },
  // --- public competition directory -------------------------------------------
  { path: "/c", area: "public-comp", auth: false },
  { path: `/c/${PUBCOMP}`, area: "public-comp", auth: false },
  { path: `/c/${PUBCOMP}/p/${PUBPLAYER}`, area: "public-comp", auth: false },
  // --- auth ---------------------------------------------------------------------
  { path: "/login", area: "auth", auth: false },
  { path: "/onboarding", area: "auth", auth: true },
  // --- console home / account ---------------------------------------------------
  { path: "/home", area: "console", auth: true },
  { path: "/inbox", area: "console", auth: true },
  { path: "/account", area: "console", auth: true },
  { path: "/money", area: "console", auth: true },
  { path: "/orgs", area: "console", auth: true },
  { path: "/tournaments", area: "console", auth: true },
  { path: `/tournaments/${TOURNAMENT}`, area: "console", auth: true },
  // --- organization workspace ---------------------------------------------------
  { path: `/org/${ORG}`, area: "org", auth: true },
  { path: `/org/${ORG}/venues`, area: "org", auth: true },
  { path: `/org/${ORG}/settlement`, area: "org", auth: true },
  { path: `/org/${ORG}/money`, area: "org", auth: true },
  { path: `/org/${ORG}/money/deliveries`, area: "org", auth: true },
  { path: `/org/${ORG}/money/reconciliation`, area: "org", auth: true },
  { path: `/org/${ORG}/money/documents/${DOC}`, area: "org", auth: true },
  { path: `/org/${ORG}/t/${TOURNAMENT}`, area: "org", auth: true },
  // --- season workspace ----------------------------------------------------------
  { path: `/seasons/${LEAGUE}`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/teams`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/registrations`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/readiness`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/fixtures`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/fixtures/calendar`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/fixtures/match-day`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/standings`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/register`, area: "season", auth: true },
  { path: `/seasons/${LEAGUE}/money`, area: "season", auth: true },
  { path: `/seasons/${SETTLED}`, area: "season", auth: true },
  { path: `/seasons/${SETTLED}/money`, area: "season", auth: true },
  { path: `/seasons/${SETTLED}/money/case/${CASE}`, area: "season", auth: true },
  { path: `/seasons/${SETTLED}/standings`, area: "season", auth: true },
  // --- auction ---------------------------------------------------------------------
  { path: `/seasons/${LEAGUE}/auction`, area: "auction", auth: true },
  { path: `/seasons/${LEAGUE}/auction/live`, area: "auction", auth: true },
  { path: `/seasons/${LEAGUE}/auction/cockpit`, area: "auction", auth: true },
  { path: `/seasons/${LEAGUE}/auction/spectate`, area: "auction", auth: true },
  { path: `/seasons/${LEAGUE}/auction/board`, area: "auction", auth: true },
  { path: `/seasons/${LEAGUE}/auction/overlay`, area: "auction", auth: true },
  { path: `/seasons/${LEAGUE}/auction/ledger`, area: "auction", auth: true },
  { path: `/seasons/${LEAGUE}/auction/engine`, area: "auction", auth: true },
  { path: `/seasons/${SETTLED}/auction`, area: "auction", auth: true },
  { path: `/seasons/${SETTLED}/auction/replay`, area: "auction", auth: true },
  // --- platform admin ---------------------------------------------------------------
  { path: "/admin", area: "admin", auth: true },
  { path: "/admin/orgs", area: "admin", auth: true },
  { path: `/admin/orgs/${ORG}`, area: "admin", auth: true },
  { path: "/admin/users", area: "admin", auth: true },
  { path: `/admin/users/${PERSON}`, area: "admin", auth: true },
  { path: "/admin/audit", area: "admin", auth: true },
  { path: "/admin/health", area: "admin", auth: true },
  { path: "/admin/messaging", area: "admin", auth: true },
  // --- dev / misc --------------------------------------------------------------------
  { path: "/gallery", area: "misc", auth: true },
  { path: "/this-route-does-not-exist", area: "misc", auth: false },
];

export const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 834, 1024, 1280, 1440, 1920];
export const SHOT_WIDTHS = [390, 768, 1440];
