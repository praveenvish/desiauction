/**
 * PX-10 marketing copy — the PX-1 05 §2 homepage and §3 pricing, verbatim where
 * the content guide is prescriptive. Every capability named below is one the
 * certified platform actually has; there are NO fabricated customers and NO
 * fabricated metrics (out of scope, and the content guide forbids them). The
 * customer-stories section is an honest placeholder, not an invented testimonial.
 *
 * 2026-07-25 — the rule is enforced by a THIRD state, not just "write it" or
 * "cut it". Where a section needs a claim that the codebase cannot evidence, the
 * copy is written AND carries an inline `TODO(founder):` naming exactly what has
 * to be confirmed and why the repo could not settle it. Grep this file for
 * `TODO(founder)` to get the fact-check list. Silently inventing and silently
 * dropping are both failures; a flagged draft is neither.
 */

export const LANDING = {
  hero: {
    h1: "SOLD, without the shouting.",
    sub: "IPL-style player auctions for local cricket. Owners bid from their phones, the hall watches the big screen, and every rupee lands on a ledger.",
    ctaPrimary: { label: "Start your auction", href: "/login" },
    // The strongest honest offer on the page: the Free tier below is ₹0,
    // cadence "always", limited to "Up to 4 teams and 40 players" — so the note
    // states the real limit rather than a vague beta promise. Both halves are
    // evidenced by PRICING in this same file; nothing here is aspirational.
    ctaNote: "Free during beta · always free for up to 4 teams and 40 players",
    // The secondary CTA leads OUT of the page, to the published tournament
    // directory. It used to point at "#demo" — the hero's own stage card, an
    // anchor already in view, so the click did nothing observable. The label
    // says "browse", not "watch live": /c lists published tournaments and does
    // not read auction status at all, so promising liveness would be a claim
    // the destination cannot keep.
    ctaSecondary: { label: "Browse tournaments", href: "/c" },
    // The stage runs a scripted, clearly-labelled simulation. Players are
    // FICTIONAL by hard rule (no real or celebrity names — personality rights),
    // and the label below the stage says so in plain words.
    demoLabel: "Simulated demo · fictional players",
    script: [
      {
        lot: 23,
        sold: 18,
        name: "Arjun Pawar",
        role: "Right-hand bat",
        team: "Strikers",
        opening: 40000,
        final: 120000,
      },
      {
        lot: 24,
        sold: 19,
        name: "Dev Nair",
        role: "Fast bowler",
        team: "Royals",
        opening: 20000,
        final: 65000,
      },
      {
        lot: 25,
        sold: 20,
        name: "Imran Qureshi",
        role: "Wicket-keeper",
        team: "Titans",
        opening: 30000,
        final: 85000,
      },
    ],
    demoTeams: ["Strikers", "Royals", "Titans"],
  },
  // The night in three beats — each one a verifiable, shipped capability.
  beats: {
    kicker: "How the night runs",
    h2: "One link in. One ledger out.",
    steps: [
      {
        title: "One link registers your players",
        body: "Share it on WhatsApp. Players sign themselves up; you approve. Already have a player sheet? It imports in minutes.",
      },
      {
        title: "Owners bid; the hall watches the stage",
        body: "Every bid is checked by the server before it counts — never the loudest voice. The projector runs the show, no app required.",
      },
      {
        title: "The gavel falls; the books write themselves",
        body: "Dues are computed the moment SOLD lands. UPI, cash or bank — every payment gets a numbered receipt.",
      },
    ],
  },
  // Built for the worst moment of the night — the failure modes ARE the pitch.
  worst: {
    kicker: "When things go wrong",
    h2: "Built for the worst moment of the night",
    items: [
      {
        title: "A phone dies mid-auction",
        body: "The room lives on the server, not the device. Reconnect on any phone and land exactly where things are.",
      },
      {
        title: "A wrong sale",
        body: "Undo rewinds it — in front of everyone, on the record.",
      },
      {
        title: "A settlement argument",
        body: "Numbered receipts and an append-only ledger nobody — including us — can edit afterwards. The argument ends.",
      },
    ],
    rehearse: "Your auction has one take. Rehearse it tonight — free.",
  },
  // The morning after — the artifact WhatsApp and Excel can never produce.
  money: {
    kicker: "The morning after",
    h2: "No more “bhai, hisaab?”",
    body: "When the gavel falls, the maths is already done. UPI, cash and bank collections are recorded against dues on numbered receipts, in a ledger that only ever grows — corrections are new entries that explain themselves.",
    receipt: {
      number: "RCP-0007",
      title: "Team dues — Strikers",
      amount: "₹1,20,000",
      method: "Recorded · UPI",
      ledgerLine: "Ledger entry №214 · append-only",
      note: "Sample receipt — this is the artifact every payment produces.",
    },
  },
  // (2026-07-25 founder call: the standalone honesty section is retired from
  // the page; its load-bearing sentence — free during beta — stays as the
  // hero's CTA note, and pricing candor lives on /pricing.)
  // The high-level architecture note the CTO scope asks for — marketing-level,
  // not a technical spec, and true to how the platform is actually built.
  // Reused by /features and /security — not rendered on the home page itself.
  foundation: {
    h2: "Built on one source of truth",
    cards: [
      {
        title: "Server-verified",
        body: "Every bid is checked on the server before it counts. Screens display the outcome — they don't decide it.",
      },
      {
        title: "Immutable ledger",
        body: "The auction and the money are an append-only record. Nothing is edited after the fact; corrections are new entries that explain themselves.",
      },
      {
        title: "Recovers itself",
        body: "The room's state lives on the server as a snapshot. A dropped phone reconnects to exactly where things are — nothing missed.",
      },
    ],
  },
  // --- Live tournaments strip (2026-07-25) ----------------------------------
  // The ONLY section on this page whose contents are not written here: the rows
  // come from `publicCompetitionsDirectory`, i.e. real competitions their own
  // organizers chose to publish. That is why it is allowed to exist under the
  // no-fabrication rule — a number or a name that came out of the database is
  // evidence, not copy. The section renders nothing at all when the query is
  // empty or fails, so it can never become a claim about tournaments we do not
  // have.
  live: {
    kicker: "From the public directory",
    h2: "Tournaments already on DesiAuction.",
    // Deliberately does NOT promise squads: the public squad list is populated
    // from `registrations.team_id`, which a settled auction does not currently
    // write (see the lifecycle TODO on "Teams" below). Promising a page that
    // renders empty would be the one kind of lie this page cannot afford.
    sub: "Published by their own organizers. Open any one for the tournament page — and when the auction is on, watch the room itself, no account needed.",
    cta: { label: "Browse all tournaments", href: "/c" },
  },
  // --- Beyond auction night: the lifecycle -----------------------------------
  // The page sold one night; the product runs a season. Every stage below was
  // read out of the codebase before it was written down, and the honest closer
  // is as load-bearing as the list: an organizer who arrives expecting a points
  // table has to learn it does not exist HERE, not after signing up.
  lifecycle: {
    kicker: "Beyond auction night",
    h2: "The season doesn't end when the gavel does.",
    sub: "The auction is one night. DesiAuction holds the shape around it — from the club that runs the tournament to the receipt that closes it.",
    stages: [
      {
        name: "Organization",
        body: "Your club, its members, and who is allowed anywhere near the money.",
      },
      {
        name: "Tournament",
        body: "The competition that comes back every year, kept as one thing across editions.",
      },
      {
        // Evidence: `competitions` rows carry an optional `tournamentId`, and
        // the org activity feed has a "Season cloned" phrase — cloning is real.
        name: "Season",
        body: "This year's edition. Clone the last one and change the dates.",
      },
      {
        name: "Players",
        body: "One registration link with saved drafts and approvals — or import the sheet you already keep.",
      },
      {
        name: "Auction",
        body: "Paddles, the auctioneer's cockpit, the public stage, the board, and a replay of every call.",
      },
      {
        // RESOLVED 2026-07-25 — this line is true on both screens; no founder
        // action needed. An earlier draft flagged it as half-false, on the
        // premise that the sale never writes `registrations.team_id`. That
        // premise is stale: `8ff05b6` ("the sale reaches the squad, not just the
        // lot") added the write inside the sale transaction, so a sell stamps
        // the registration and a requeue/withdraw clears it — the organizer's
        // Teams tab, the roster export and the PUBLIC squad list now agree.
        //
        // What misled the draft: a local database still holding auctions that
        // settled BEFORE that commit, whose squads are genuinely empty. That is
        // data residue, not a defect — `pnpm --filter @desiauction/web
        // backfill:squads` repairs it (dry-run by default, `--apply` to write).
        name: "Teams",
        body: "Every franchise's squad and what it paid, taken straight from the auction's own record.",
      },
      {
        // TODO(founder): confirm "Grounds" is presentable. Found create-venue,
        // create-ground and an available/unavailable toggle at
        // apps/web/src/app/org/[slug]/venues/venues-panel.tsx — real, shipped,
        // and about as thin as a feature can be while still being true. It earns
        // a line because fixtures schedule ONTO grounds; it would not survive
        // being called a feature of its own.
        name: "Grounds",
        body: "Your venues and the grounds under them, marked available or not.",
      },
      {
        name: "Fixtures",
        body: "Generate the round-robin, then work it as a list, a calendar, or one match day at a time.",
      },
      {
        // TODO(founder): confirm "Match day" is presentable. Found
        // apps/web/src/app/seasons/[slug]/fixtures/match-day/match-day-panel.tsx,
        // which offers exactly three buttons — start, complete, cancel — grouped
        // by ground. There is no score entry and no in-match anything, which is
        // why this line says only what the buttons do. If that reads as too
        // little to advertise, cut the stage and let "Fixtures" carry it.
        name: "Match day",
        body: "Start, complete or call off each fixture as the day actually runs.",
      },
      {
        // Was "Dues, receipts, invoices, the ledger, Tally-ready exports and the
        // year-end close" — three of those six do not exist. The issuance lane
        // tells its own operator "This lane will not be able to issue anything"
        // for a tax invoice; the exporter is reachable from no screen; there is
        // no fiscal close. Dues, receipts and the ledger are real and carry the
        // line on their own.
        name: "Money",
        body: "Dues computed when the gavel falls, numbered receipts, and an append-only ledger.",
      },
    ],
    // TODO(founder): confirm you want to say this out loud on the home page.
    // It is TRUE — `fixtures` (packages/db/src/schema.ts:360) has no score
    // columns, there is no results or statistics table anywhere in the schema,
    // and the only "standings" in the repo is the auction-money board at
    // apps/web/src/app/seasons/[slug]/auction/board/. The alternative is to
    // delete the paragraph, but then the stage list above implies a league
    // product that stops dead after the toss, which is the more expensive
    // surprise. Confirm the wording, and confirm whether you want a roadmap
    // promise ("scorecards are next") attached — I have no evidence for a date,
    // so I have not written one.
    gap: {
      title: "What isn't here yet",
      body: "DesiAuction records that a match was played, not what happened in it. There are no scorecards, no points table and no player statistics today. You should know that before you sign up, not after.",
    },
  },
  // --- Pricing preview ------------------------------------------------------
  // The tiers themselves are read from PRICING (below) so the home page can
  // never quote a price the pricing page has retired. Nothing here restates a
  // "Published at GA" tier as though the number were known.
  pricingPreview: {
    kicker: "What it costs",
    h2: "Free through the beta. Free forever for a small tournament.",
    sub: "You buy a Pass per tournament — no subscriptions, no seats, no “contact sales”.",
    cta: { label: "See the full pricing", href: "/pricing" },
  },
  // --- Trust & beta candor ---------------------------------------------------
  // The page carries no customer names by policy. Until now it paid that price
  // silently: a visitor read the absence as a product with nothing to show.
  // This section spends the constraint instead of eating it.
  trust: {
    kicker: "Where we are",
    h2: "In public beta, with no customers to name yet.",
    // Deliberately says "here is", not "below" or "on the right": the list sits
    // beside this paragraph on desktop and under it on a phone, and a copy line
    // that names a direction is wrong on one of the two.
    body: "There are no logos on this page and no quotes from organizers, because we do not have them yet — and we would rather say so than borrow someone else's name to look older than we are. Here is what we will put our name to instead. Every line is something you can check inside the product before you trust it with a rupee.",
    items: [
      {
        title: "Server-verified bidding",
        body: "Every bid is checked on the server before it counts. Screens display the outcome — they don't decide it.",
      },
      {
        title: "Append-only ledger",
        body: "Nothing is edited after the fact. Corrections are new entries that explain themselves — ours included.",
      },
      {
        title: "Numbered receipts",
        body: "Every collection you record produces a numbered receipt, and every receipt lands on the ledger.",
      },
      {
        // This band's own header promises "every line is something you can
        // check inside the product". "Exportable, forever" was not checkable:
        // squads and fixtures download as CSV, and nothing else does.
        title: "Your data, yours",
        body: "Your data is never held hostage. Squads and fixtures download as CSV, and the record stays readable for as long as you have an account.",
      },
    ],
    cta: { label: "How the platform is built", href: "/security" },
  },
  // --- FAQ -------------------------------------------------------------------
  // Five questions a guest asks BEFORE signing up. Four are answered from
  // content that already exists (PRICING.faqs and the help-centre FAQ set in
  // ./help.ts); the fifth is flagged.
  faq: {
    kicker: "Questions",
    h2: "What people ask before they start.",
    items: [
      {
        question: "Do I need to install an app?",
        // Source: FAQS "Do I need to install anything?" in ./help.ts, plus the
        // "No app required for spectators" capability mark below.
        answer:
          "No. DesiAuction runs in a browser on any device — the organizer's laptop, an owner's phone, and the projector in the hall. Spectators need nothing at all.",
      },
      {
        question: "Can people watch without an account?",
        // Verified in code: apps/web/src/app/seasons/[slug]/auction/spectate/page.tsx
        // tries `publicSpectatorView` FIRST, which serves any competition whose
        // visibility is public — no session. Bidding still requires a paddle.
        answer:
          "Yes. Publish your tournament and its page is public: anyone with the link can follow the live auction as a spectator, with no sign-in. Bidding is the part that needs an account.",
      },
      {
        question: "How long does setup take?",
        // TODO(founder): this answer refuses to quote a duration, and that is
        // deliberate — there is no measured setup time anywhere in this repo, no
        // onboarding telemetry that records one, and inventing "ten minutes"
        // would be exactly the fabrication the file header forbids. The steps
        // themselves are verified (org → season → registration link → approvals
        // → auction setup, each its own screen). Either confirm a real figure
        // from your own runs and I will put it in the first sentence, or keep
        // the step list as the answer.
        answer:
          "There is no sales call and no setup fee. You create the organization, create the season, share the registration link, approve the players who sign up, and set the auction up — each of those is one screen, and you can do all of them yourself.",
      },
      {
        question: "Why passes, not subscriptions?",
        // Verbatim from PRICING.faqs below — the two surfaces must not drift.
        answer:
          "A tournament is an event, not a monthly habit. You pay once, for the tournament you're running — no seats to count, no subscription to remember to cancel.",
      },
      {
        question: "What if I want a refund?",
        // Source: FAQS "Is there a refund if I change my mind?" in ./help.ts,
        // prefixed with the beta truth from PRICING.betaBanner.
        answer:
          "Nothing is charged during the beta. When paid passes launch, you get a full refund until your auction goes live — after that the pass is consumed. Platform-fault abandonment is always refunded.",
      },
    ],
    cta: { label: "Read the full FAQ", href: "/help/faq" },
  },
  beta: {
    kicker: "Ready when you are",
    title: "Make your auction night unforgettable.",
    note: "Create the tournament, run the live auction, and settle every rupee — all in one place. Free through the beta.",
    ctaPrimary: { label: "Start your auction", href: "/login" },
    ctaSecondary: { label: "Explore tournaments", href: "/c" },
  },
} as const;

// 2026-07-24 Product Creation Council ruling: the stat bar, capability grid,
// fake-video section and illustrative testimonials are GONE, not moved. A
// zero-customer product's only honest proof is the product visibly working
// (the hero stage). The former testimonials' "explicit exception" to the
// no-fabrication rule is retired — this file is now uniformly no-fabrication,
// including operational stats we cannot yet evidence (uptime, support hours,
// "bank-grade", "most trusted").

/**
 * Hero proof chips — restatements of certified capabilities, NOT metrics.
 * Each names something the platform verifiably does today; the no-fabrication
 * rule applies to these exactly as it does to everything above.
 */
export const TRUST_MARKS = [
  "Server-verified bidding",
  "Append-only ledger",
  "UPI-ready collections",
  // Was "Real-time stage & sound" until 2026-07-25. There is NO audio anywhere
  // in this platform: a search for `new Audio`, `AudioContext`, `playSound`,
  // `useSound` and every audio file extension across apps/ and packages/
  // returned this marketing string as the only hit in the repo. The claim sat
  // in a band labelled "Platform capabilities", under the header directly
  // above, which says every mark names something verifiable. The stage half is
  // true and carries the point on its own, so the sound half is simply gone.
  "Real-time stage",
  "No app required for spectators",
] as const;

export interface PricingTier {
  readonly name: string;
  readonly price: string;
  readonly cadence: string;
  readonly limits: string;
  readonly highlights: readonly string[];
  readonly featured?: boolean;
  /**
   * Where a reader who has chosen this tier actually goes. The page shipped
   * with none: `main` contained ZERO interactive elements, so the only tab
   * stops were the FAQ disclosures and a visitor who had decided to buy had
   * nothing to press.
   *
   * That was a misreading of the no-checkout mandate. "No checkout" forbids a
   * payment affordance; it does not forbid a next step. Every label below is
   * true during the beta — starting is free, and the two unpriced tiers lead to
   * a conversation rather than a cart.
   */
  readonly cta: { readonly label: string; readonly href: string };
}

/**
 * A pricing question, optionally with the document that settles it. The link is
 * the difference between an answer and a summary of an answer: the refund entry
 * paraphrases a policy that exists in full at `/legal/refunds`, and a reader who
 * is about to spend money is entitled to the full text without hunting for it.
 */
export interface PricingFaq {
  readonly question: string;
  readonly answer: string;
  readonly link?: { readonly label: string; readonly href: string };
}

/**
 * One line of the tier comparison. `cells` runs in `PRICING.tiers` order — a
 * boolean where the answer is only included/not, a string where the answer is a
 * quantity or a qualifier. Nothing here may say more than the tier cards do;
 * the table exists to let the three be read ACROSS, not to smuggle in claims
 * that the cards were too honest to make.
 */
export interface ComparisonRow {
  readonly label: string;
  readonly cells: readonly (string | boolean)[];
}

export const PRICING = {
  h1: "Simple, public pricing.",
  sub: "You buy a Pass per tournament — no subscriptions, no seats, no “contact sales”.",
  // The single best fact on this page, promoted out of the tail of a 30-word
  // sentence inside a muted disclaimer. A visitor's real question is "what is
  // my exposure if I start tonight and the price turns out to be wrong for
  // me?", and the answer is: zero, permanently. It was previously the LAST
  // eleven words a reader would reach, styled as fine print.
  betaHeadline: "Tournaments started during beta stay free forever.",
  betaBanner:
    "During beta, everything is free — every tier, every feature, no card. Paid Passes arrive with general availability, at the prices published on this page.",
  trustLine:
    "Trust is never premium: the immutable ledger, receipts, and audit are in every tier, including Free.",
  // Canon (docs/45 §Limit philosophy): "Free limits are honest capacity limits,
  // not crippled trust — a free gully auction gets the same incorruptible
  // ledger." Said out loud here because the trust line above is a claim about
  // what is NOT taken away, and a claim like that is worth nothing unstated.
  trustLineNote:
    "Free is a capacity limit, not a lesser product. A four-team gully auction is settled on exactly the same record as a sixteen-team league.",
  tiers: [
    {
      name: "Free",
      price: "₹0",
      cadence: "always",
      limits: "Up to 4 teams and 40 players",
      // "invoices" and "exports" both named things the platform refuses to do:
      // the issuance lane will not issue a tax invoice, and no screen reaches
      // the exporter. A tier card is the last thing read before a decision, so
      // it says only what a buyer will find.
      highlights: [
        "The full live auction, cockpit and public stage",
        "Settlement and numbered receipts",
        "Immutable ledger and audit trail",
      ],
      cta: { label: "Start free", href: "/login" },
    },
    {
      name: "Pro Pass",
      price: "Published at GA",
      cadence: "per tournament",
      limits: "Up to 16 teams and 400 players",
      highlights: [
        "Everything in Free",
        "Custom branding and auction overlays",
        "Larger tournaments",
      ],
      featured: true,
      cta: { label: "Start free during beta", href: "/login" },
    },
    {
      name: "Association",
      price: "Published at GA",
      cadence: "bundle",
      limits: "Multiple tournaments across a season",
      highlights: [
        "Everything in Pro Pass",
        "Bundled passes for an association's season",
        "One relationship, many tournaments",
      ],
      // The page's sub-headline promises "no 'contact sales'" while this tier
      // is literally sold as "One relationship, many tournaments" — so the one
      // tier that does need a human offered no way to reach one.
      cta: { label: "Talk to us about a season", href: "/contact" },
    },
  ] satisfies readonly PricingTier[],
  // --- Comparison table -------------------------------------------------------
  // Three cards side by side are a set of three pitches; a table is the only
  // shape in which they are one decision. Every row below restates something
  // the cards already say (limits, cadence, highlights) — the table adds
  // structure, not claims. The price row is NOT written here: the page reads it
  // off `tiers` so the table can never quote a figure the cards have retired.
  comparison: {
    caption: "What each tier includes",
    rows: [
      { label: "Teams", cells: ["Up to 4", "Up to 16", "By agreement"] },
      { label: "Players in the pool", cells: ["Up to 40", "Up to 400", "By agreement"] },
      {
        label: "Tournaments covered",
        cells: ["Every tournament, within these limits", "One tournament", "A season's worth"],
      },
      { label: "The full live auction, cockpit and public stage", cells: [true, true, true] },
      { label: "Settlement and numbered receipts", cells: [true, true, true] },
      { label: "Immutable ledger and audit trail", cells: [true, true, true] },
      { label: "Custom branding and auction overlays", cells: [false, true, true] },
    ] satisfies readonly ComparisonRow[],
    // TODO(founder): the two "By agreement" cells are the honest reading of the
    // only evidence in the repo — docs/45-billing-model.md §Tiers gives
    // Association as "Bundle pricing (n passes + org features)" and "Per
    // agreement, self-serve bundles first", i.e. deliberately no numbers. Free
    // (4/40) and Pro (16/400) are quoted from that same table and match the tier
    // cards exactly. If Association has real quantities — a maximum tournament
    // count, a per-tournament ceiling — give them to me and they replace both
    // cells; inventing "unlimited" would be the one number on this page nobody
    // could hold us to.
    note: "Association quantities are set per agreement — talk to us and we will put yours in writing.",
  },
  // --- Procurement -------------------------------------------------------------
  // An association, school or corporate league does not buy the way a club
  // does: there is a budget line, an approver, and someone who wants paperwork
  // before the tournament rather than after it. This page had ZERO matches for
  // GST, GSTIN, PO, tax invoice or TDS, so that buyer had nothing to take to
  // their committee and no way to find out. Every claim below is evidenced from
  // the platform; the one thing that is NOT known is stated as not known.
  procurement: {
    kicker: "Buying for an organization",
    h2: "If this has to go past a committee.",
    intro:
      "Associations, schools and corporate leagues buy against a budget line, not a card. Here is exactly where that stands today — including the part we cannot answer yet.",
    points: [
      {
        title: "There is nothing to approve yet",
        // Evidenced by absence, which is the strongest kind here: the schema
        // carries no passes, billing or subscription table, and the only payment
        // gateway in the repo (server/settlement/adapters/razorpay.ts) collects
        // TEAM dues into an organizer's own books. The platform cannot charge
        // you because it has nowhere to record a charge.
        body: "Every tournament is free through the beta, so there is no invoice to raise, no purchase order to route and no budget to release. Run the whole thing first and decide about paying afterwards — and a tournament you start during the beta stays free for good.",
      },
      {
        title: "Your own books, in your own numbering",
        // This comment used to read "Evidenced:" and then list tax invoices and
        // Tally-compatible exports. The EXPORTER exists — in the frozen IP-6
        // package — and the PRODUCT does not: it is reachable from no screen,
        // and `exportRun` / `requestExport` / `buildExportArtifact` / `ExportKind`
        // have zero non-test hits across apps/web/src. The issuance lane says to
        // its own operator, in the UI, "This lane will not be able to issue
        // anything" when the profile is GST-registered. An engine that can do a
        // thing no operator can reach is not evidence for a marketing claim.
        //
        // What IS evidenced: finops_profiles carries legal name, GST posture and
        // GSTIN; the register numbers receipts in an unbroken per-kind,
        // per-year series and seals them; every issued document can be
        // re-derived and compared against its seal.
        //
        // TODO(founder): when a document download and an accountant export are
        // reachable from a screen, this paragraph gets its second half back.
        // Until then a committee buyer must not be told they will get files.
        body: "This is the money your teams owe you, not money you owe us. Declare your legal name and GSTIN once, and the money workspace issues numbered receipts in your own unbroken series, sealed on an append-only ledger, each one re-derivable from the events behind it. Tax invoices and exports for your accountant are not built yet — raise those the way you do now.",
      },
      {
        title: "Nothing you record is held hostage",
        // "all export" was false for rosters-plus-everything. The squad CSV and
        // the fixtures CSV are the two downloads that exist.
        body: "Squads and fixtures download as CSV, and receipts, the ledger and the auction's own record stay readable whatever happens to a pass. No renewal ever stands between your organization and its own paperwork.",
      },
    ],
    // TODO(founder): this paragraph is the honest edge of what the repo can
    // evidence, and it needs four answers none of which exist in code, docs or
    // config anywhere I could find:
    //   1. Is DesiAuction itself GST-registered, and under which GSTIN? (The
    //      only GSTIN in the platform is the ORGANIZER's, on finops_profiles.)
    //   2. Can we accept a purchase order, and against what payment terms?
    //   3. Can we issue a proforma invoice / quotation ahead of payment, for a
    //      committee that must approve a figure before it releases funds?
    //   4. TDS: does a buyer deduct at source on a pass, and if so under which
    //      section? docs/46-payment-flow.md describes an invoice with "our GST
    //      breakdown, SAC code" — but that is a DESIGN for a payment flow that
    //      is not built, so it is a plan, not a fact, and I have not written it
    //      as one.
    // Answer these and the paragraph becomes three concrete sentences. Until
    // then it says we do not know, which is at least a thing a committee can
    // act on. Do NOT let it ship claiming a tax status we cannot produce.
    gap: "What this page cannot tell you yet: our own GST registration, and whether we can take a purchase order or issue a proforma invoice ahead of payment. Paid passes do not exist yet, so neither does that answer. Ask us and we will put it in writing before you commit anything.",
    cta: { label: "Talk to us about a season", href: "/contact" },
  },
  faqs: [
    {
      question: "What will a Pro Pass cost?",
      // TODO(founder): "Published at GA" is honest in its sentences and evasive
      // in its structure — it is 100% of the paid page, and there is NO GA date
      // anywhere in this repository. I checked: docs/63-release-strategy.md
      // defines GA as a per-feature gate (DoD + journeys + budgets + a11y +
      // docs + runbook), never a calendar date; docs/49 and docs/58 say only
      // "pre-GA"; nothing in content/, config or the release notes carries one.
      // So this answer promises a PUBLICATION ORDER ("published before anyone
      // is charged") rather than a date, because an order is something I can
      // evidence and a date is something I would have to invent. If you have a
      // window — even "H2 2026" or "not before the 2027 season" — give it to me
      // and it goes in the first sentence, which is where deferral stops
      // reading as evasion.
      answer:
        "We have not set it yet, and we would rather say so than print a number we might change. The price will be published on this page before anyone is ever charged for a pass — and a tournament you start during the beta stays free forever, whatever we publish.",
    },
    {
      question: "Why passes, not subscriptions?",
      answer:
        "A tournament is an event, not a monthly habit. You pay once, for the tournament you're running — no seats to count, no subscription to remember to cancel.",
    },
    {
      question: "What happens when my pass expires?",
      answer:
        "Your data is never held hostage. Everything stays readable, and squads and fixtures download as CSV. A pass covers running the auction; the records are yours to keep.",
    },
    {
      question: "Refunds?",
      // The second sentence is restored VERBATIM from the Refund Policy
      // (content/legal.ts, "Platform-fault abandonment"). The FAQ used to stop
      // after "the pass is consumed" — omitting the single clause most in the
      // reader's favour, and the only one that answers "what if it breaks on
      // the night?". A summary that drops the strongest term of the policy is
      // not a summary.
      answer:
        "Full refund until your auction goes live. After that the pass is consumed. If an auction has to be abandoned because of a fault on our side, we refund the pass — always, regardless of timing.",
      link: { label: "Read the Refund Policy", href: "/legal/refunds" },
    },
  ] satisfies readonly PricingFaq[],
  // --- Closing ------------------------------------------------------------------
  // `main` used to stop dead under the last FAQ and fall into the footer, so a
  // reader who had just been convinced had nothing to press without scrolling
  // back up past the whole page. Mirrors the landing page's closing band.
  closing: {
    kicker: "Ready when you are",
    title: "Start free. Decide about paying later.",
    note: "Create the tournament, run the live auction and settle every rupee — free through the beta, and free forever for a tournament you start now.",
    ctaPrimary: { label: "Start your auction", href: "/login" },
    ctaSecondary: { label: "See everything it does", href: "/features" },
  },
} as const;

export const FEATURE_GROUPS = [
  {
    title: "Registration",
    features: [
      "One-link player registration with saved drafts",
      "Approve, waitlist or decline — each with a notification",
      "CSV roster import with row-by-row validation",
      "Public tournament directory when you choose to publish",
    ],
  },
  {
    title: "The live auction",
    features: [
      "Server-verified bidding on every device at once",
      "Auctioneer cockpit with call, sell, undo, pause",
      "Synchronized SOLD ceremony with the player's name",
      "Self-healing recovery from a server snapshot",
      "Public spectator stage — no sign-in required",
    ],
  },
  {
    // /features renders this list as SHIPPED capability. Three of its five
    // lines were not: invoice issuance is refused by the issuance lane itself,
    // the exporter is reachable from no screen, and there is no fiscal close.
    // They are replaced by two things the workspace does do — sealed, numbered
    // documents, and re-derivation against that seal.
    title: "Money & records",
    features: [
      "Obligations computed automatically when the gavel falls",
      "Record cash, UPI and bank collections against dues",
      "Receipts numbered in an unbroken series and sealed when issued",
      "Every document re-derivable from its events and checked against its seal",
      "Squad and fixture CSV downloads",
    ],
  },
  {
    title: "Trust & governance",
    features: [
      "Grants, not roles — money authority is always deliberate",
      "Immutable, append-only ledger and audit trail",
      "Phone-first sign-in with passkeys",
      "Platform administration for observability and support",
    ],
  },
] as const;
