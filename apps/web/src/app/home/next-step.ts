/**
 * THE ONE THING TO DO NEXT (launch polish, Phase 2).
 *
 * The old /home answered "what is everything?" — a lifecycle row, six panels,
 * a chart — and left the reader to work out which of it needed them. Every
 * home now opens on a single answer, chosen here from facts the page already
 * loaded, in a fixed order of urgency:
 *
 *   1. an auction this person is IN is live right now;
 *   2. an auction this person RUNS is live right now;
 *   3. a season they run is waiting on them (the attention scan's first row);
 *   4. their team's auction is coming up — prepare the plan;
 *   5. as a player, their newest entry is waiting on the organizer;
 *   6. nothing at all yet — choose a path.
 *
 * Pure and ordered on purpose: which banner a person sees is a product
 * decision, and a decision belongs where a test can pin it.
 */

export interface NextStepLink {
  label: string;
  href: string;
}

export interface NextStep {
  key: string;
  /** Small line above the title — where this is, or how urgent. */
  eyebrow: string;
  title: string;
  /** One or two sentences: why this, why now. */
  why: string;
  cta: NextStepLink;
  secondary?: NextStepLink;
  /** "Then: …" — what happens after, so the reader can see the road. */
  then?: string;
  tone: "live" | "action" | "calm";
  /** Brand-new account: the CTA is the create-club dialog, not a link. */
  createClub?: boolean;
}

export interface NextStepInput {
  /** The team this person owns (server/roles currentTeam). */
  ownedTeam: {
    teamName: string;
    competitionSlug: string;
    competitionName: string;
    auctionStatus: string;
  } | null;
  /** A live auction in a season this person MANAGES (from the dashboard). */
  managedLive: { competitionSlug: string; competitionName: string } | null;
  /** The organizer attention scan, most urgent first. */
  attention: { label: string; detail: string; href: string }[];
  /** This person's newest registration, if they play. */
  latestEntry: { competitionName: string; status: string } | null;
  /** Holds no role anywhere: not a member, not an owner, not a player. */
  brandNew: boolean;
  /** A season whose auction this person was appointed to run (auction:conductor). */
  conducting?: {
    competitionSlug: string;
    competitionName: string;
    auctionStatus: string | null;
  } | null;
}

const LIVE = new Set(["live", "paused"]);
const UPCOMING = new Set(["scheduled"]);

/** A button says what it does: the attention row's destination names the act. */
function attentionVerb(href: string): string {
  if (href.endsWith("/registrations")) return "Review now";
  if (href.endsWith("/teams")) return "Add teams";
  if (href.includes("/auction")) return "Open auction setup";
  return "Continue";
}

export function chooseNextStep(input: NextStepInput): NextStep | null {
  const team = input.ownedTeam;
  if (team !== null && LIVE.has(team.auctionStatus)) {
    return {
      key: "owner-live",
      eyebrow: `Live now · ${team.competitionName}`,
      title: `Your auction is live — ${team.teamName} is in the room`,
      why: "Bidding is open. Your plan and purse are waiting for you in the room.",
      cta: { label: "Enter auction room", href: `/seasons/${team.competitionSlug}/auction/live` },
      then: "your squad and receipts appear here when the hammer falls",
      tone: "live",
    };
  }
  const night = input.conducting ?? null;
  if (night !== null && night.auctionStatus !== null && LIVE.has(night.auctionStatus)) {
    return {
      key: "auctioneer-live",
      eyebrow: `Live now · ${night.competitionName}`,
      title: "You're running the auction — the room is waiting",
      why: "Open the cockpit to put the next lot on the block.",
      cta: { label: "Open the cockpit", href: `/seasons/${night.competitionSlug}/auction/cockpit` },
      tone: "live",
    };
  }
  if (input.managedLive !== null) {
    const live = input.managedLive;
    return {
      key: "organizer-live",
      eyebrow: `Live now · ${live.competitionName}`,
      title: "Your auction night is running",
      why: "Every bid, sale and purse is updating in the room right now.",
      cta: { label: "Open the auction", href: `/seasons/${live.competitionSlug}/auction` },
      secondary: { label: "Big screen", href: `/seasons/${live.competitionSlug}/auction/board` },
      then: "close out the night, then settle the money",
      tone: "live",
    };
  }
  const first = input.attention[0];
  if (first !== undefined) {
    return {
      key: "organizer-attention",
      eyebrow: `${first.detail} · your next step`,
      title: first.label,
      why:
        input.attention.length > 1
          ? `${String(input.attention.length - 1)} more thing${input.attention.length === 2 ? " is" : "s are"} waiting below — this one is first.`
          : "Nothing else is waiting on you.",
      cta: { label: attentionVerb(first.href), href: first.href },
      tone: "action",
    };
  }
  if (night !== null && (night.auctionStatus === null || UPCOMING.has(night.auctionStatus))) {
    return {
      key: "auctioneer-prepare",
      eyebrow: `Auction night · ${night.competitionName}`,
      title: "You're the auctioneer for this season",
      why:
        night.auctionStatus === null
          ? "The organizer hasn't set the auction up yet. You'll run it from the cockpit when they do."
          : "Walk through the cockpit before the night — the lot order, the owners, the big screen.",
      cta: { label: "Open the auction", href: `/seasons/${night.competitionSlug}/auction` },
      tone: "action",
    };
  }
  if (team !== null && UPCOMING.has(team.auctionStatus)) {
    return {
      key: "owner-prepare",
      eyebrow: `Auction coming up · ${team.competitionName}`,
      title: `Get ${team.teamName} ready for auction night`,
      why: "Pick your targets and your maximum bid for each. Only you can see your plan.",
      cta: { label: "Open my plan", href: `/seasons/${team.competitionSlug}/auction/plan` },
      secondary: { label: "Team page", href: `/seasons/${team.competitionSlug}/teams` },
      then: "bid live on the night — your plan follows you into the room",
      tone: "action",
    };
  }
  const entry = input.latestEntry;
  if (entry !== null && entry.status === "submitted") {
    return {
      key: "player-waiting",
      eyebrow: entry.competitionName,
      title: "Your registration is with the organizer",
      why: "You'll get a message the moment they approve it.",
      cta: { label: "My sports", href: "/me" },
      then: "once approved, you're in the auction pool",
      tone: "calm",
    };
  }
  if (input.brandNew) {
    return {
      key: "choose-path",
      eyebrow: "Welcome to DesiAuction",
      title: "Run a tournament, or play in one?",
      why: "Organizers set up a club and run the auction. Players find a tournament and register — no club needed.",
      cta: { label: "Create your club", href: "/orgs" },
      secondary: { label: "Find a tournament to play", href: "/c" },
      tone: "calm",
      createClub: true,
    };
  }
  return null;
}
