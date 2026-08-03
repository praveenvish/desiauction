import type { Block } from "./blocks";

/**
 * PX-10 Help Centre content (PX-1 05 §8: the ten launch articles), grouped into
 * the guide categories the CTO named. Every article describes the platform AS
 * BUILT — the capabilities of IP-1…IP-6 and their PX-2…PX-9 surfaces. No
 * workflow here is invented; where a screenshot belongs, none is faked (image
 * capture is PX-1 content debt §13, noted in the delivery risks).
 */

export interface HelpCategory {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}

export interface HelpArticle {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly readMinutes: number;
  readonly blocks: readonly Block[];
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Sign in, find your way around, and run your first night.",
  },
  {
    slug: "organizer",
    title: "Organizer guide",
    description: "Set up a season, open registration, and build fixtures.",
  },
  {
    slug: "player",
    title: "Player & owner guide",
    description: "Register, join a team, and bid on auction night.",
  },
  {
    slug: "auction",
    title: "Auction guide",
    description: "Prepare the room and conduct the live auction.",
  },
  {
    slug: "settlement",
    title: "Settlement guide",
    description: "Record collections, handle waivers, and close the case.",
  },
  {
    slug: "finops",
    title: "Financial operations guide",
    // Was "Receipts, invoices, exports, and closing the books" — three of those
    // four cannot be done: the issuance lane refuses to issue an invoice, no
    // screen reaches the exporter, and there is no fiscal close. The article
    // itself has said so correctly since its rewrite; the category blurb did not.
    description: "Declare your profile, issue receipts, and keep a sealed document register.",
  },
];

/**
 * The contact footer on every article. Two defects, both fixed here:
 *
 *   • the address was plain text on all twelve pages — a callout could not carry
 *     a link at all until `Block` gained the field (content/blocks.tsx). The
 *     first link is now a real mailto:;
 *   • "put THAT in the subject line" named nothing. The string is AUCTION NIGHT
 *     (content/support.ts), and the second link pre-fills it so the reader does
 *     not have to retype a phrase we never told them.
 */
const CONTACT_FOOTER: Block = {
  kind: "callout",
  tone: "info",
  text: "Still stuck? Email {0} and we'll get back within a day. If it's happening during a live auction, {1} — those go to the front of the queue.",
  links: [
    { text: "support@desiauction.in", href: "mailto:support@desiauction.in" },
    {
      text: "put AUCTION NIGHT in the subject line",
      href: "mailto:support@desiauction.in?subject=AUCTION%20NIGHT",
    },
  ],
};

export const HELP_ARTICLES: readonly HelpArticle[] = [
  // --- Getting started -----------------------------------------------------------------
  {
    slug: "getting-started",
    title: "A tour of DesiAuction",
    summary: "What the platform does, how it's organized, and where to go next.",
    category: "getting-started",
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "DesiAuction runs the player auction for a tournament: registration, the live auction night, and the money afterwards — with one shared truth on every screen. This tour explains how the product is laid out so you can find the rest.",
      },
      // There are FOUR rail items, not five (components/shell/nav.ts RAIL). The
      // fifth — Money — was withdrawn under DA-18 because the surface behind it
      // was a placeholder, and this list went on naming it as a place to work,
      // with a description ("what you owe") that the /money page never had a
      // query for. Its receipts half is true and now lives under Home, which is
      // where a signed-in reader actually starts.
      { kind: "heading", level: 2, text: "The four places you'll work" },
      {
        kind: "list",
        items: [
          {
            text: "{0} — your starting point once you sign in: what needs attention, your seasons, and your registrations.",
            links: [{ text: "Home", href: "/home" }],
          },
          {
            text: "{0} — every recurring competition you run or take part in, and every season under them.",
            links: [{ text: "Tournaments", href: "/tournaments" }],
          },
          {
            text: "{0} — the organizations you belong to, their members and grants.",
            links: [{ text: "Organizations", href: "/orgs" }],
          },
          {
            text: "{0} — this help centre, always one click away.",
            links: [{ text: "Help", href: "/help" }],
          },
        ],
      },
      {
        // /money is a real page and is NOT in the rail, so a reader who is owed
        // a receipt has to be told where it is. What it shows is exactly the
        // documents issued to your teams — it computes no balance and no due.
        kind: "paragraph",
        text: "There's one more page worth knowing: {0} lists every receipt a club has issued to a team you bid for. It isn't in the navigation bar during the beta, so bookmark it or come back here.",
        links: [{ text: "Money", href: "/money" }],
      },
      { kind: "heading", level: 2, text: "Roles are grants, not titles" },
      {
        kind: "paragraph",
        text: "DesiAuction never asks \"are you an admin?\". It asks whether you hold a specific capability on a specific thing — running an organization, conducting an auction, handling the money. That's why owning an organization doesn't automatically let you touch its books: money authority is a separate, deliberate grant. Your organizer hands out grants from the organization page — {0} names every role and what it can do.",
        links: [{ text: "the roles guide", href: "/help/roles-and-grants" }],
      },
      { kind: "heading", level: 2, text: "Where to go next" },
      {
        kind: "list",
        items: [
          {
            text: "Organizing a tournament? Start with {0}.",
            links: [{ text: "setting up a season", href: "/help/competition-setup" }],
          },
          {
            text: "Playing or owning a team? Read {0}.",
            links: [{ text: "registering and bidding", href: "/help/for-owners" }],
          },
          {
            text: "Running auction night? See {0}.",
            links: [{ text: "the end-to-end walkthrough", href: "/help/auction-night" }],
          },
        ],
      },
      CONTACT_FOOTER,
    ],
  },
  {
    slug: "signing-in",
    title: "Signing in, passkeys and account safety",
    summary: "Phone-first sign-in, adding a passkey, and keeping your account secure.",
    category: "getting-started",
    readMinutes: 3,
    blocks: [
      { kind: "heading", level: 2, text: "Signing in with your phone" },
      {
        kind: "paragraph",
        text: "DesiAuction signs you in with your mobile number — no email, no password. Enter your 10-digit Indian number, and we send a 6-digit code by SMS. Enter the code and you're in. The first time, we ask your name; it appears on team sheets and the auction stage.",
      },
      {
        kind: "callout",
        tone: "info",
        // The real numbers, from server/auth/otp.ts: CODE_TTL_MS (5 min),
        // RESEND_COOLDOWN_MS (30s), MAX_PER_HOUR (5), MAX_ATTEMPTS (5). A reader
        // stuck at the phone step could not previously find out why.
        text: "A code is valid for five minutes. You can ask for another after 30 seconds, and for up to five in an hour; five wrong entries lock that number briefly. Those limits protect your account — and once you have a passkey you never wait for a code again.",
      },
      { kind: "heading", level: 2, text: "Add a passkey" },
      {
        kind: "paragraph",
        // "under Security" named a section /account does not have. Its headings
        // are Profile, Passkeys, Active sessions, Security activity,
        // Notifications and Your data — and there IS a public /security page
        // about the ledger, so a reader following the old instruction landed on
        // marketing copy instead of their own account.
        text: "A passkey lets you sign in with your device's fingerprint, face, or screen lock — no code to wait for. Add one from your {0} page, under Passkeys. You can add more than one (phone and laptop, say) and name each, so you always have a way in.",
        links: [{ text: "Account", href: "/account" }],
      },
      { kind: "heading", level: 2, text: "Staying safe" },
      {
        kind: "list",
        items: [
          { text: "We will never ask for your sign-in code. Anyone who does is not us." },
          {
            text: "See every device signed into your account under {0} → Active sessions, and sign out any you don't recognize.",
            links: [{ text: "Account", href: "/account" }],
          },
          { text: "Your phone number is your identity here — keep it with you." },
        ],
      },
      CONTACT_FOOTER,
    ],
  },
  {
    slug: "auction-night",
    title: "Running your first auction night",
    summary: "The whole journey, end to end: from creating a season to closing the books.",
    category: "getting-started",
    readMinutes: 8,
    blocks: [
      {
        kind: "paragraph",
        text: "This is the map of an entire tournament on DesiAuction. Each step links to the detailed guide.",
      },
      { kind: "heading", level: 2, text: "Before the night" },
      {
        kind: "steps",
        items: [
          {
            text: "Create an organization, then a season inside it. See {0}.",
            links: [{ text: "season setup", href: "/help/competition-setup" }],
          },
          {
            text: "Open registration and share the link. Players sign up with one tap; you approve, waitlist, or import a roster. See {0}.",
            links: [{ text: "the registration desk", href: "/help/registration-desk" }],
          },
          {
            text: "Build fixtures if your tournament needs a schedule. See {0}.",
            links: [{ text: "fixtures", href: "/help/fixtures" }],
          },
          {
            text: "Set up the auction: teams, owners, purses, and the lots to be sold. See {0}.",
            links: [{ text: "auction setup", href: "/help/auction-setup" }],
          },
        ],
      },
      { kind: "heading", level: 2, text: "On the night" },
      {
        kind: "steps",
        items: [
          {
            text: "Open the cockpit and go live. Every bid is checked on the server and lands on the projector, every owner's phone, and every spectator's screen at the same instant.",
          },
          {
            text: "Call lots, take bids, and mark each SOLD. If something goes wrong, you can undo, pause, and the room recovers itself. See {0}.",
            links: [{ text: "conducting the auction", href: "/help/conducting-the-auction" }],
          },
          {
            text: "Spectators watch a public stage — no sign-in needed — if you've made the season public.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "After the gavel" },
      {
        kind: "steps",
        items: [
          {
            text: "The settlement case opens automatically with every obligation computed. Record collections, handle any waivers, and close the case. See {0}.",
            links: [{ text: "money after the gavel", href: "/help/money-after-the-gavel" }],
          },
          {
            text: "Issue receipts and keep a sealed document register. See {0}.",
            links: [
              { text: "receipts and your document register", href: "/help/receipts-and-exports" },
            ],
          },
        ],
      },
      {
        kind: "callout",
        tone: "success",
        text: "That's the whole arc: register, auction, settle, receipt. Every rupee is accounted for, and the ledger is immutable.",
      },
      CONTACT_FOOTER,
    ],
  },

  {
    // NEW — the positive counterpart to the false privacy claim that used to
    // sit in the fixtures article ("registration lists are never exposed").
    // Every disclosure below was read off the public routes: /c, /c/[slug] and
    // /c/[slug]/p/[number].
    slug: "whats-public",
    title: "What's public about you and your tournament",
    summary: "Exactly what a stranger with a link can see — and what nobody can.",
    category: "getting-started",
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "A tournament starts private. Publishing it is a real disclosure, not just a listing, so here is precisely what changes.",
      },
      { kind: "heading", level: 2, text: "Before you publish" },
      {
        kind: "paragraph",
        text: "Nothing is reachable without an account. The season, its players, its fixtures and its auction are visible only to your organization — a stranger with the link is asked to sign in. The one exception is the registration link, which is meant to be shared and works either way.",
      },
      { kind: "heading", level: 2, text: "After you publish" },
      {
        kind: "list",
        items: [
          {
            text: "The season is listed in the public {0} directory, with its name, organization, location and dates.",
            links: [{ text: "tournaments", href: "/c" }],
          },
          {
            text: "Its page shows the approved player pool, the teams and their squads, and any fixtures you have published.",
          },
          {
            text: "Each approved player gets their own page — name, number, playing role, age and styles if given, their photo if they uploaded one, and which team signed them.",
          },
          {
            text: "Anyone with the link can watch the live auction, the venue board and the broadcast overlay, with no sign-in.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "What is never public" },
      {
        kind: "list",
        items: [
          { text: "Phone numbers. They appear on no page a visitor can reach, published or not." },
          {
            text: "Money. Dues, collections, receipts and the ledger are behind a grant, always.",
          },
          { text: "Anything about a season you have not published." },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        text: "Player pages are built to be shared — they carry a preview card for messaging apps — but they are marked not to be indexed, so they do not turn up in web searches. Tell your players that their name, role and team become shareable when you publish.",
      },
      CONTACT_FOOTER,
    ],
  },
  {
    // NEW. The product has four capability partitions and eight named roles and
    // the help centre named none of them. The specific trap this article exists
    // to prevent: `org:staff` (packages/core/src/capabilities.ts) holds neither
    // `auction.conduct` nor `auction.override`, so a "staff" secretary can
    // follow the whole auction guide and be refused at go-live.
    slug: "roles-and-grants",
    title: "Who can do what: roles and grants",
    summary: "The four separate keys — organization, auction, settlement and finance.",
    category: "getting-started",
    readMinutes: 5,
    blocks: [
      {
        kind: "paragraph",
        text: "DesiAuction never asks whether you are an admin. It asks whether you hold a particular capability on a particular thing. A grant is what gives you one, and grants come in named sets for convenience only.",
      },
      { kind: "heading", level: 2, text: "Running the organization" },
      {
        kind: "definitions",
        items: [
          {
            term: "Owner",
            def: "Everything about the club and its competitions — members, tournaments, seasons, teams, registrations, venues and fixtures — plus the two auction-night capabilities, conducting and undo. Owners are also the only people who can hand out grants.",
          },
          {
            term: "Staff",
            def: "The day job: tournaments, teams, registrations, player verification, venues and fixtures. Staff can set an auction up completely, and cannot conduct it.",
          },
          { term: "Viewer", def: "Can see the workspace and change nothing." },
        ],
      },
      {
        kind: "callout",
        tone: "warning",
        text: "This is the one that catches people out. Staff can build the whole auction — teams, purses, paddles, lots — and will be refused at go-live, because conducting the auction is an owner capability. Decide who is holding the gavel before the night, not on it.",
      },
      { kind: "heading", level: 2, text: "The money is a separate key" },
      {
        kind: "paragraph",
        text: "Owning the organization does not give you its books. Settlement and finance are their own partitions, granted deliberately and separately:",
      },
      {
        kind: "definitions",
        items: [
          {
            term: "Settlement officer",
            def: "Records collections against what teams owe, and works the case.",
          },
          {
            term: "Settlement controller",
            def: "Everything an officer can do, plus waivers, adjustments and closing the case.",
          },
          {
            term: "Finance clerk",
            def: "Sees the finance workspace, issues documents and dispatches them.",
          },
          {
            term: "Finance accountant / controller",
            def: "The wider finance workspace, up to declaring the organization's financial profile and opening a numbering series.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "Asking for a grant" },
      {
        kind: "paragraph",
        text: "If a desk isn't there, you don't hold its grant — the platform hides what you cannot use rather than showing you a locked door. Ask an owner of the organization; grants are issued from the organization page and can be revoked the same way.",
      },
      CONTACT_FOOTER,
    ],
  },

  // --- Organizer -----------------------------------------------------------------------
  {
    slug: "competition-setup",
    title: "Setting up a season and opening registration",
    summary: "Create a season, add teams, and open the registration door.",
    category: "organizer",
    readMinutes: 5,
    blocks: [
      { kind: "heading", level: 2, text: "Create the season" },
      {
        kind: "paragraph",
        text: "Seasons live inside an organization. From {0}, create one; from its page, create a season with a name and season. It starts private — only your team can see it.",
        links: [{ text: "Organizations", href: "/orgs" }],
      },
      { kind: "heading", level: 2, text: "Make it public (optional)" },
      {
        kind: "paragraph",
        // "publishing is about discovery, not access" was half false and the
        // wrong half. Register: true, the link works unpublished. Spectate:
        // FALSE — the spectate page falls back to the member-gated view, whose
        // liveGate requires a session AND membership, so an unpublished season
        // bounces a stranger to /login. Publishing is exactly about access for
        // spectators.
        text: "Publishing a season lists it in the public {0} directory and lets anyone watch the auction live, with no sign-in. Until you publish, the register link still works for anyone you send it to — but the spectate link does not: on an unpublished season only members of your organization can watch, and everyone else is asked to sign in. If you want a hall full of spectators, publish before the night.",
        links: [{ text: "tournaments", href: "/c" }],
      },
      { kind: "heading", level: 2, text: "Open registration" },
      {
        kind: "steps",
        items: [
          { text: "Open registration from the season's Overview." },
          {
            text: "Share the register link with players. They sign up with their phone number and their details.",
          },
          { text: "Applications arrive on the Registrations tab for you to approve." },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        text: "Team owners are invited separately, by link — see the auction setup guide. Registration is for players.",
      },
      CONTACT_FOOTER,
    ],
  },
  {
    slug: "registration-desk",
    title: "The registration desk: approving, waitlisting, importing",
    summary: "Work through applications, run a waitlist, and import a roster from CSV.",
    category: "organizer",
    readMinutes: 5,
    blocks: [
      { kind: "heading", level: 2, text: "Working through applications" },
      {
        kind: "paragraph",
        text: "The Registrations tab shows every application with its status. Approve the ones you want, waitlist the ones you might, and decline the rest with a reason. Each decision notifies the player in their inbox.",
      },
      {
        kind: "definitions",
        items: [
          {
            term: "Approved",
            def: "The player is in, and eligible to be entered into the auction as a lot.",
          },
          { term: "Waitlisted", def: "Held for now; if a spot opens they're next in line." },
          {
            term: "Declined",
            def: "Not approved this time. The reason category is shared with the player.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "Importing a roster" },
      {
        kind: "paragraph",
        text: "Already have your players in a spreadsheet? Import them from CSV instead of collecting registrations one by one. The desk validates each row and tells you exactly which ones need fixing before it commits anything — no half-imports.",
      },
      {
        kind: "callout",
        tone: "warning",
        text: "You can keep registering and importing right up until you close registration. Once the auction is built from the approved list, keep the roster stable — late changes mean rebuilding lots.",
      },
      CONTACT_FOOTER,
    ],
  },
  {
    // NEW. The icon rule materially changes how an organizer builds the lot
    // list — an icon is pre-signed and never reaches the block — and the help
    // centre documented none of it while the release notes claimed articles
    // "covering the whole journey". Every statement below is read off the
    // shipped code: the Icon/Captain toggles and their mutual exclusion
    // (registrations dashboard), the pool filter that drops icons
    // (server/auction/auction-ready.ts), the "Icon with no team" warning, and
    // the coach editor on the Teams tab.
    slug: "icons-captains-and-coaches",
    title: "Icons, captains and coaches",
    summary: "Pre-sign your marquee players, mark the captains, and name each team's coach.",
    category: "organizer",
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "Not every player goes under the hammer. Most tournaments keep one or two marquee names attached to a team from the start, and most teams have a captain and a coach the room already knows. All three are marks you set on the registration desk and the Teams tab.",
      },
      { kind: "heading", level: 2, text: "Icons never enter the auction" },
      {
        kind: "paragraph",
        text: "An icon is a player pre-signed to a team. Mark an approved registration as Icon and it is removed from the auction pool — it will never be queued as a lot, never be called, and never be bid on. This is the one mark that changes what happens on the night, so set your icons before you build the lot list.",
      },
      {
        kind: "callout",
        tone: "warning",
        text: "An icon with no team is the trap. The player has left the pool and joined nobody, so they simply vanish from the night. The desk flags this as “Icon with no team” — assign the team as soon as you set the mark.",
      },
      { kind: "heading", level: 2, text: "Captains" },
      {
        kind: "paragraph",
        text: "Captain is a label, not a rule: a captain is still auctioned like anyone else, and the mark shows on the registration desk, the team sheet and the squad board. A player is either an Icon or a Captain, never both — marking one greys out the other.",
      },
      { kind: "heading", level: 2, text: "Coaches" },
      {
        kind: "paragraph",
        text: "A coach is a name on a team, not an account: type it into the coach field on the Teams tab and it appears wherever that team is listed. Coaches do not sign in, hold a paddle, or receive anything.",
      },
      CONTACT_FOOTER,
    ],
  },
  {
    slug: "fixtures",
    title: "Fixtures: generating, resolving conflicts, publishing",
    summary: "Turn venues and dates into a conflict-free schedule, then publish it.",
    category: "organizer",
    readMinutes: 5,
    blocks: [
      { kind: "heading", level: 2, text: "Venues first" },
      {
        kind: "paragraph",
        text: "Fixtures need somewhere to happen. Add your grounds under the organization's Venues, with their available dates. The scheduler only ever places a match where and when a ground is actually free.",
      },
      { kind: "heading", level: 2, text: "Generate the schedule" },
      {
        kind: "paragraph",
        text: "From the Fixtures tab, generate a schedule. DesiAuction lays out the matches deterministically and flags any conflict — a team double-booked, a ground overcommitted — rather than quietly producing an impossible calendar.",
      },
      { kind: "heading", level: 2, text: "Resolve and publish" },
      {
        kind: "steps",
        items: [
          {
            text: "Work through any flagged conflicts on the calendar view until the schedule is clean.",
          },
          {
            text: "Publish. Published fixtures — dates, venues, match-ups — appear on the public season page for players and spectators.",
          },
        ],
      },
      {
        // The old sentence — "Player phone numbers and registration lists are
        // never exposed" — was a FALSE PRIVACY CLAIM, the most damaging kind.
        // Phone numbers: true, they appear on no public surface. Registration
        // lists: false. /c/[slug] renders a public Players section, and every
        // approved player has a link-shareable public profile at
        // /c/[slug]/p/[number] with an OG card. Say what is public instead, and
        // point at the article that spells it out.
        kind: "callout",
        tone: "info",
        text: "Phone numbers are never public — they appear on no page a visitor can reach. Names and squads are, once you publish: see {0}.",
        links: [{ text: "what's public about a tournament", href: "/help/whats-public" }],
      },
      CONTACT_FOOTER,
    ],
  },

  // --- Player & owner ------------------------------------------------------------------
  {
    slug: "registering-as-a-player",
    title: "Registering for a season",
    summary: "How to sign up as a player, and what happens next.",
    category: "player",
    readMinutes: 3,
    blocks: [
      { kind: "heading", level: 2, text: "Signing up" },
      {
        kind: "paragraph",
        text: "Your organizer shares a register link. Open it, sign in with your phone number, and fill in your details. If you started and got interrupted, your draft is saved — come back to the same link and pick up where you left off.",
      },
      { kind: "heading", level: 2, text: "What happens next" },
      {
        kind: "list",
        items: [
          {
            text: "Your organizer reviews applications. You'll hear the outcome in your {0}.",
            links: [{ text: "inbox", href: "/inbox" }],
          },
          { text: "If you're approved, you may be entered into the auction as a lot." },
          {
            text: "You can see your registrations any time on {0}.",
            links: [{ text: "Home", href: "/home" }],
          },
        ],
      },
      CONTACT_FOOTER,
    ],
  },
  {
    slug: "for-owners",
    title: "For team owners: joining, bidding, your purse, what you owe",
    summary: "Accept your invite, bid on the night, and understand your dues.",
    category: "player",
    readMinutes: 6,
    blocks: [
      { kind: "heading", level: 2, text: "Joining your team" },
      {
        kind: "paragraph",
        text: "Owners are invited by link. Accept it and you're taken straight into the auction room for your season, holding a paddle for your team.",
      },
      { kind: "heading", level: 2, text: "Bidding on the night" },
      {
        kind: "steps",
        items: [
          {
            text: "When a player is up, place your bid from your phone. The current bid and the leading team update live for everyone at once.",
          },
          { text: "Your purse is tracked as you go — you can never bid past what you have left." },
          {
            text: "When the auctioneer marks SOLD, the room hears the name and the price. If it's you, the player joins your squad.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        text: "Every bid is verified on the server before it counts. What you see on your screen is what everyone sees — there is nothing to dispute afterwards.",
      },
      { kind: "heading", level: 2, text: "What you owe" },
      {
        // Two false claims removed. (1) DUES: /money runs one query,
        // myDocuments — there is no obligation, due or balance query behind it,
        // so nothing on that page tells an owner what they owe. (2) INBOX:
        // lib/inbox-events.ts is the complete label map and carries twelve
        // auth/profile/registration keys and no finance event at all; /money's
        // own source comment says "/inbox has no finance writer".
        kind: "paragraph",
        text: "After the auction, your organizer works out what you owe from the auction's own record and tells you directly — there is no running balance on your account today. What you do get is the paperwork: when your organizer records your payment, the receipt appears on {0}.",
        links: [{ text: "Money", href: "/money" }],
      },
      {
        kind: "callout",
        tone: "warning",
        text: "Your inbox carries sign-in, profile and registration news only. No receipt or payment is ever announced there, so check Money rather than waiting to be notified.",
      },
      CONTACT_FOOTER,
    ],
  },

  // --- Auction -------------------------------------------------------------------------
  {
    slug: "auction-setup",
    title: "Auction setup: teams, owners, purses, paddles, lots",
    summary: "Everything that must be in place before you can go live.",
    category: "auction",
    readMinutes: 6,
    blocks: [
      { kind: "heading", level: 2, text: "Build the auction" },
      {
        kind: "paragraph",
        text: "From the Auction tab, create the auction. You set the configuration — purses, bid increments, the rules of the night — once, at creation. It's locked in from then on, so the night can't drift.",
      },
      { kind: "heading", level: 2, text: "Teams, owners and paddles" },
      {
        kind: "list",
        items: [
          { text: "Add the teams that will bid." },
          {
            text: "Invite each team's owner by link. When they accept, they hold that team's paddle.",
          },
          { text: "Every team starts with the same purse — the money they have to spend." },
        ],
      },
      { kind: "heading", level: 2, text: "Lots" },
      {
        kind: "paragraph",
        text: "Lots are the players to be sold. Queue your approved players as lots, in the order you want to call them. The Readiness check on the Auction tab tells you exactly what's still missing before you can go live — no guessing on the night.",
      },
      {
        kind: "callout",
        tone: "success",
        text: "When Readiness is green, you're ready. Open the cockpit and start the night.",
      },
      CONTACT_FOOTER,
    ],
  },
  {
    slug: "conducting-the-auction",
    title: "Conducting the auction: cockpit, undo, freeze, recovery",
    summary: "Run the room with confidence — including when something goes wrong.",
    category: "auction",
    readMinutes: 7,
    blocks: [
      { kind: "heading", level: 2, text: "The cockpit" },
      {
        kind: "paragraph",
        text: "The cockpit is the auctioneer's control surface. You call a lot, watch bids arrive, and mark the result. The projector, owners' phones, and the public stage all follow the cockpit in real time from a single source of truth.",
      },
      { kind: "heading", level: 2, text: "When you need to undo" },
      {
        kind: "paragraph",
        text: "Called the wrong lot, or a SOLD that shouldn't have landed? Undo reverses it cleanly and the whole room updates. Undo is a high-trust action — it needs an owner-level grant, not just conduct — because it rewrites what happened.",
      },
      { kind: "heading", level: 2, text: "Freeze and recovery" },
      {
        kind: "list",
        items: [
          {
            // The quoted string "resuming shortly" existed in exactly one file
            // in the repository: this one. What the room actually shows is
            // "Paused — the clock is stopped" on the spectator panel and
            // "AUCTION PAUSED" on the ceremony stage. The capability is real;
            // the quotation was invented, and a quotation is a promise about
            // words on a screen.
            text: 'Pause the auction any time — spectators see a calm "Paused — the clock is stopped", and the stage reads AUCTION PAUSED. Nobody sees a broken screen.',
          },
          {
            text: "If a device drops, it reconnects to the exact state of the room. Nothing is missed, because the room's state is a server snapshot, not each screen's memory.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        text: 'A player who goes unsold "passes for now" — never the word "unsold" on a public screen. Dignity is a rule, not a nicety.',
      },
      { kind: "heading", level: 2, text: "After the last lot" },
      {
        kind: "paragraph",
        text: "Complete the auction to close the night. The results — squads and spend — become available, and the settlement case opens automatically. The full record stays available as a ledger and a replay.",
      },
      CONTACT_FOOTER,
    ],
  },

  {
    // NEW. /seasons/{slug}/auction/board and .../overlay ship, are linked from
    // the cockpit's "Screens for the room" card, and were documented nowhere.
    // Both read the same spectator-safe snapshot as /spectate, both render with
    // no chrome, and both are noindex.
    slug: "screens-for-the-room",
    title: "Screens for the room: the venue board and the broadcast overlay",
    summary: "Put the auction on a projector, and into your stream, with two chrome-free screens.",
    category: "auction",
    readMinutes: 3,
    blocks: [
      {
        kind: "paragraph",
        text: "Besides the cockpit you run the night from, the auction has two screens meant for everyone else in the hall. Both are fed by the same live snapshot as the cockpit, both show only what a spectator may see, and neither has any navigation on it — they are made to be left running.",
      },
      { kind: "heading", level: 2, text: "The venue board" },
      {
        kind: "paragraph",
        text: "The board is the projector screen: who is on the block, the current price, every team's purse and squad, the biggest buys and the last few sales. Open it on the laptop plugged into the projector and leave it alone for the night.",
      },
      { kind: "heading", level: 2, text: "The broadcast overlay" },
      {
        kind: "paragraph",
        text: "The overlay is a transparent lower-third built to be dropped into streaming software as a browser source, so it composites over your camera feed. You can put a sponsor's name on it when you copy the link.",
      },
      { kind: "heading", level: 2, text: "Getting the links" },
      {
        kind: "paragraph",
        text: "Both live under “Screens for the room” in the auction cockpit, with a copy button each — you open them somewhere else, on a projector laptop or in a streaming tool, so copy the address rather than clicking through.",
      },
      {
        kind: "callout",
        tone: "info",
        text: "Both screens follow the same rule as the spectator page: on a published season anyone with the link can open them, and on an unpublished one only your own organization can. Publish before the night if the projector laptop isn't signed in.",
      },
      CONTACT_FOOTER,
    ],
  },

  // --- Settlement ----------------------------------------------------------------------
  {
    slug: "money-after-the-gavel",
    title: "Money after the gavel: collections, waivers, closing the case",
    summary: "The settlement desk — recording money in, adjusting, and closing.",
    category: "settlement",
    readMinutes: 6,
    blocks: [
      { kind: "heading", level: 2, text: "The case opens itself" },
      {
        kind: "paragraph",
        text: "When the auction completes, a settlement case opens with every obligation already computed from what was sold — who owes what, to the rupee. You don't tally anything by hand.",
      },
      {
        kind: "callout",
        tone: "warning",
        text: "The money desk needs its own grant. Owning the organization is not enough — trusting someone with the books is a separate, deliberate act. Ask your organizer for the settlement grant if you can't see the desk.",
      },
      { kind: "heading", level: 2, text: "Recording collections" },
      {
        kind: "steps",
        items: [
          {
            text: "As owners pay — cash, UPI, or bank transfer — record each payment against their obligation.",
          },
          { text: "The balance updates live. Everyone sees the same numbers." },
        ],
      },
      { kind: "heading", level: 2, text: "Waivers and adjustments" },
      {
        kind: "paragraph",
        text: "Sometimes you agree to waive part of a due. Waivers and adjustments are high-trust actions reserved for a controller-level grant, and every one is recorded — the ledger always explains itself.",
      },
      { kind: "heading", level: 2, text: "Closing the case" },
      {
        kind: "paragraph",
        text: "When everything is collected or accounted for, ready the case and close it. Closing produces an immutable evidence package and unlocks the closure ceremony — the moment the books are officially done.",
      },
      CONTACT_FOOTER,
    ],
  },

  // --- Financial operations ------------------------------------------------------------
  {
    slug: "receipts-and-exports",
    // This topic described a finance product we do not have yet: Tally exports,
    // invoice issuance, corrections, in-app delivery with downloads, and sealing
    // the fiscal year. Six of its eight claims were false — the title and summary
    // among them. Every one of those functions exists in the platform and is
    // reachable from no screen, so a reader could not have discovered the gap
    // except by trying and failing. Help that oversells is worse than no help:
    // it is read before the purchase and disproved after it. What follows is
    // what the finance workspace actually does today. Restore a claim here only
    // when a real operator can perform it from a real screen.
    title: "Receipts and your document register",
    summary: "Issue receipts, keep a sealed record, and check that it still reproduces.",
    category: "finops",
    readMinutes: 4,
    blocks: [
      { kind: "heading", level: 2, text: "Declare your profile first" },
      {
        kind: "paragraph",
        text: "Financial operations start when your organization declares its financial profile — its legal name and tax posture — and opens a numbering series. That's what lets the platform number documents correctly and consistently. Until both exist, nothing can be issued.",
      },
      {
        kind: "paragraph",
        text: "Finance is a separate key from running competitions, and owning the club does not grant it. Someone with the Grants role has to give you a finance role before the workspace opens — until then it isn't there.",
      },
      { kind: "heading", level: 2, text: "Receipts" },
      {
        kind: "list",
        items: [
          {
            text: "A receipt records money that has arrived. It is issued after a settlement officer records the payment — the platform does not collect money for you.",
          },
          {
            text: "Once a payment is captured, the platform issues its receipt automatically — or you can issue one yourself from the finance workspace.",
          },
          {
            text: "Documents are numbered in an unbroken series per kind, per financial year, and sealed when issued. Nothing is edited after the fact.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "What isn't here yet" },
      {
        kind: "list",
        items: [
          {
            text: "Tax invoices. If your organization is registered for GST, the platform will not issue a tax invoice rather than guess the tax split — so raise bills the way you do now.",
          },
          {
            // Name Tally explicitly even though we do not do it. This article
            // is the search hit for "tally export" (content.test.ts asserts it),
            // and someone who heard the word elsewhere deserves a straight
            // answer here rather than an empty result page.
            text: "Exports for your accountant, including Tally-compatible files, and downloadable or printable copies of a document.",
          },
          { text: "Sealing a financial year." },
        ],
      },
      { kind: "heading", level: 2, text: "Checking the record" },
      {
        kind: "paragraph",
        text: "Every issued document can be re-derived from the events behind it and compared against the seal taken when it was issued. The workspace shows you that verdict plainly, including when a document does not reproduce — which is the case worth knowing about.",
      },
      CONTACT_FOOTER,
    ],
  },
];

// --- Frequently asked questions --------------------------------------------------------

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export const FAQS: readonly FaqItem[] = [
  {
    question: "Do I need to install anything?",
    answer:
      "No. DesiAuction runs in your browser on any device — phone, laptop, or the projector on auction night.",
  },
  {
    question: "Do players need an email address?",
    answer:
      "No. Sign-in is by Indian mobile number and a one-time code. No email is required anywhere.",
  },
  {
    question: "How much does it cost?",
    answer:
      "During beta, everything is free, with full features. Paid passes arrive at general availability — and tournaments started during beta stay free forever.",
  },
  {
    question: "Who can see the money?",
    answer:
      "Only people you explicitly grant the settlement or finance capability to. Owning an organization does not by itself grant access to its books — money authority is always a separate, deliberate grant.",
  },
  {
    question: "Can a bid be disputed?",
    answer:
      "Every bid is verified on the server before it counts, and lands on every screen at the same instant. There is one record of the night, and it is not editable after the fact except by an audited undo.",
  },
  {
    question: "What happens to my data if I stop using DesiAuction?",
    answer:
      // "records stay readable and exportable" claimed a general exporter that
      // no screen reaches: `exportRun`, `requestExport`, `buildExportArtifact`
      // and `ExportKind` have zero non-test hits in apps/web/src. What DOES
      // download today is the squad CSV (teams panel) and the fixtures CSV, so
      // the claim is scoped to those two.
      "Your data is never held hostage. Everything stays readable for as long as you have an account, squads and fixtures download as CSV, and financial ledgers are retained as immutable history. Exports for your accountant aren't built yet. See our Data Retention policy for details.",
  },
  {
    question: "Is there a refund if I change my mind?",
    answer:
      "When paid passes launch, you get a full refund until your auction goes live. After that the pass is consumed. Platform-fault abandonment is always refunded. See the Refund Policy.",
  },
];

export function helpArticlesIn(category: string): readonly HelpArticle[] {
  return HELP_ARTICLES.filter((article) => article.category === category);
}

export function helpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

export function helpCategory(slug: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((category) => category.slug === slug);
}
