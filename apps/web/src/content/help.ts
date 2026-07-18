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
    description: "Set up a competition, open registration, and build fixtures.",
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
    description: "Receipts, invoices, exports, and closing the books.",
  },
];

const CONTACT_FOOTER: Block = {
  kind: "callout",
  tone: "info",
  text: "Still stuck? Email support@desiauction.in and we'll get back within a day. On auction night, put that in the subject line — those go first.",
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
      { kind: "heading", level: 2, text: "The five places you'll work" },
      {
        kind: "list",
        items: [
          {
            text: "{0} — your starting point once you sign in: what needs attention, your competitions, and your money.",
            links: [{ text: "Home", href: "/home" }],
          },
          {
            text: "{0} — every tournament you run or take part in.",
            links: [{ text: "Competitions", href: "/competitions" }],
          },
          {
            text: "{0} — the organizations you belong to, their members and grants.",
            links: [{ text: "Organizations", href: "/orgs" }],
          },
          {
            text: "{0} — what you owe and every receipt you've been issued.",
            links: [{ text: "Money", href: "/money" }],
          },
          {
            text: "{0} — this help centre, always one click away.",
            links: [{ text: "Help", href: "/help" }],
          },
        ],
      },
      { kind: "heading", level: 2, text: "Roles are grants, not titles" },
      {
        kind: "paragraph",
        text: "DesiAuction never asks \"are you an admin?\". It asks whether you hold a specific capability on a specific thing — running an organization, conducting an auction, handling the money. That's why owning an organization doesn't automatically let you touch its books: money authority is a separate, deliberate grant. Your organizer hands out grants from the organization page.",
      },
      { kind: "heading", level: 2, text: "Where to go next" },
      {
        kind: "list",
        items: [
          {
            text: "Organizing a tournament? Start with {0}.",
            links: [{ text: "setting up a competition", href: "/help/competition-setup" }],
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
        text: "A code is valid for five minutes. If you request too many in a row, we ask you to wait — that limit protects your account. A passkey sidesteps the wait entirely.",
      },
      { kind: "heading", level: 2, text: "Add a passkey" },
      {
        kind: "paragraph",
        text: "A passkey lets you sign in with your device's fingerprint, face, or screen lock — no code to wait for. Add one from your {0} page under Security. You can add more than one (phone and laptop, say) and name each, so you always have a way in.",
        links: [{ text: "Account", href: "/account" }],
      },
      { kind: "heading", level: 2, text: "Staying safe" },
      {
        kind: "list",
        items: [
          { text: "We will never ask for your sign-in code. Anyone who does is not us." },
          {
            text: "See every device signed into your account under {0} → Security, and sign out any you don't recognize.",
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
    summary: "The whole journey, end to end: from creating a competition to closing the books.",
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
            text: "Create an organization, then a competition inside it. See {0}.",
            links: [{ text: "competition setup", href: "/help/competition-setup" }],
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
            text: "Spectators watch a public stage — no sign-in needed — if you've made the competition public.",
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
            text: "Issue receipts and invoices, and export for your accountant. See {0}.",
            links: [{ text: "receipts, invoices and exports", href: "/help/receipts-and-exports" }],
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

  // --- Organizer -----------------------------------------------------------------------
  {
    slug: "competition-setup",
    title: "Setting up a competition and opening registration",
    summary: "Create a competition, add teams, and open the registration door.",
    category: "organizer",
    readMinutes: 5,
    blocks: [
      { kind: "heading", level: 2, text: "Create the competition" },
      {
        kind: "paragraph",
        text: "Competitions live inside an organization. From {0}, create one; from its page, create a competition with a name and season. It starts private — only your team can see it.",
        links: [{ text: "Organizations", href: "/orgs" }],
      },
      { kind: "heading", level: 2, text: "Make it public (optional)" },
      {
        kind: "paragraph",
        text: "Publishing a competition lists it in the public {0} directory and lets anyone watch the auction live. Until you publish, the register and spectate links still work for anyone you send them to — publishing is about discovery, not access.",
        links: [{ text: "competitions", href: "/c" }],
      },
      { kind: "heading", level: 2, text: "Open registration" },
      {
        kind: "steps",
        items: [
          { text: "Open registration from the competition's Overview." },
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
            text: "Publish. Published fixtures — dates, venues, match-ups — appear on the public competition page for players and spectators.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        text: "Only fixture times and venues are ever public. Player phone numbers and registration lists are never exposed.",
      },
      CONTACT_FOOTER,
    ],
  },

  // --- Player & owner ------------------------------------------------------------------
  {
    slug: "registering-as-a-player",
    title: "Registering for a competition",
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
        text: "Owners are invited by link. Accept it and you're taken straight into the auction room for your competition, holding a paddle for your team.",
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
        kind: "paragraph",
        text: "After the auction, your dues for the players you won appear on {0}. When your organizer records a payment, or issues you a receipt, it shows up there and in your inbox.",
        links: [{ text: "Money", href: "/money" }],
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
            text: 'Pause the auction any time — spectators see a calm "resuming shortly", not a broken screen.',
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
    title: "Receipts, invoices and exports (including Tally)",
    summary: "Issue documents, deliver them, and hand clean books to your accountant.",
    category: "finops",
    readMinutes: 6,
    blocks: [
      { kind: "heading", level: 2, text: "Declare your profile first" },
      {
        kind: "paragraph",
        text: "Financial operations start when your organization declares its financial profile — its legal name and tax posture — and opens a numbering series. That's what lets the platform number documents correctly and consistently.",
      },
      { kind: "heading", level: 2, text: "Receipts and invoices" },
      {
        kind: "list",
        items: [
          { text: "A receipt records money received; an invoice records dues raised." },
          {
            text: "Once a payment is captured, the platform can issue its receipt automatically — or you can issue documents yourself from the finance workspace.",
          },
          {
            text: "A correction issues a fresh document rather than editing a sealed one — the record is never quietly changed.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "Delivery" },
      {
        kind: "paragraph",
        text: "Issued documents are delivered to the recipient's {0}, where they can be viewed and downloaded. If a delivery fails, the finance workspace shows it and lets you retry.",
        links: [{ text: "inbox", href: "/inbox" }],
      },
      { kind: "heading", level: 2, text: "Exports for your accountant" },
      {
        kind: "paragraph",
        text: "Export your books as a Tally-compatible file to hand straight to your accountant. Every export is verified against the ledger it came from, so what you hand over always matches the source.",
      },
      { kind: "heading", level: 2, text: "Closing the year" },
      {
        kind: "paragraph",
        text: "At year end, attest your days, resolve any exceptions, and seal the fiscal period. A sealed year is closed for good — reopening it is a deliberate, audited override.",
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
      "Your data is never held hostage. Records stay readable and exportable, and financial ledgers are retained as immutable history. See our Data Retention policy for details.",
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
