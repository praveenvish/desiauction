import {
  IconBolt,
  IconCheck,
  IconGavel,
  IconPin,
  IconReceipt,
  IconRupee,
  IconShieldCheck,
  IconTrophy,
  IconUsers,
  type KitTone,
} from "@desiauction/ui";
import type { ReactNode } from "react";

/**
 * The feed is read by organizers, not operators, so the raw event name is the
 * wrong thing to print: "finops.PeriodClosed" is a fact about our ledger
 * machinery, not about their night. Known events get the sentence a human would
 * say; anything unmapped falls back to the mechanical transform below, with the
 * internal domain word translated so "Finops" never reaches a screen.
 */
const ACTIVITY_PHRASE: Record<string, string> = {
  "auction.BidAccepted": "Bid accepted",
  "auction.AuctionAborted": "Auction stopped",
  "auction.conduct": "Auction conducted",
  "competition.created": "Season created",
  "competition.cloned": "Season cloned",
  "finops.PeriodOpened": "Books opened",
  "finops.PeriodClosed": "Books closed",
  "finops.PeriodReopened": "Books reopened",
  "finops.DayAttested": "Day's books attested",
  "finops.ProfileDeclared": "Finance profile declared",
  "finops.dispatch": "Receipt delivered",
  "finops.document": "Document issued",
  // What the ledger actually emits — mapped once the feed was read against
  // real finance data rather than left to the mechanical fallback.
  "finops.CertificationDerived": "Books certified",
  "finops.ExportRequested": "Export requested",
  "finops.ExportCompleted": "Export ready",
  "finops.SeriesOpened": "Numbering series opened",
  "finops.DocumentIssued": "Document issued",
  "finops.DispatchRequested": "Receipt queued",
  "finops.DispatchSent": "Receipt sent",
  "finops.DispatchConfirmed": "Receipt delivered",
  "competition.status_changed": "Season status changed",
  "registration.approved": "Registration approved",
  "registration.imported": "Registrations imported",
  "registration.added": "Player added",
  "registration.team_assigned": "Player assigned to a team",
  "tournament.created": "Tournament created",
  "team.coach_set": "Coach set",
  "venue.created": "Venue added",
  "ground.created": "Ground added",
  "invite.created": "Invitation sent",
  "invite.accepted": "Invitation accepted",
  "fixture.generated": "Fixtures generated",
  "fixture.schedule": "Fixtures scheduled",
  "fixture.publish": "Fixtures published",
  "auction.AuctionCreated": "Auction created",
  "auction.AuctionOpened": "Auction opened",
  "auction.AuctionClosed": "Auction closed",
  "auction.LotSold": "Lot sold",
  "auction.LotUnsold": "Lot went unsold",
  "auction.owner_join": "Team owner joined",
  "grant.issued": "Paddle granted",
  "grant.revoked": "Paddle revoked",
  "org.created": "Organization created",
  // Written by the privacy desk when a member or player asked to be erased.
  "person.erased": "A member's account was erased",
  "payment.captured": "Payment received",
  "payment.failed": "Payment failed",
  "registration.submitted": "New registration",
  "registration.approve": "Registration approved",
  "registration.waitlist": "Registration waitlisted",
  "settlement.PaymentCaptured": "Payment received",
  "settlement.ObligationWaived": "Amount waived",
  "settlement.CaseClosed": "Settlement closed",
  "team.created": "Team added",
};

/** Internal domain words → what the organizer calls the same thing. */
const ACTIVITY_DOMAIN: Record<string, string> = {
  finops: "Finance",
  competition: "Season",
  grant: "Access",
  auth: "Sign-in",
  org: "Organization",
};

/** "grant.issued" -> "Paddle granted"; unmapped "x.YDone" -> "X y done". */
export function activityLabel(action: string): string {
  const phrase = ACTIVITY_PHRASE[action];
  if (phrase !== undefined) return phrase;
  const parts = action.split(".");
  const domain = parts[0] ?? action;
  const tail = parts.slice(1).join(" ");
  const named = ACTIVITY_DOMAIN[domain] ?? domain.charAt(0).toUpperCase() + domain.slice(1);
  if (tail === "") return named;
  const words = tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]/g, " ")
    .toLowerCase();
  return `${named} ${words}`;
}

const ACTIVITY_STYLE: Record<string, { tone: KitTone; icon: ReactNode }> = {
  auction: { tone: "gold", icon: <IconGavel /> },
  registration: { tone: "green", icon: <IconCheck /> },
  competition: { tone: "gold", icon: <IconTrophy /> },
  tournament: { tone: "gold", icon: <IconTrophy /> },
  team: { tone: "blue", icon: <IconUsers /> },
  org: { tone: "blue", icon: <IconUsers /> },
  invite: { tone: "blue", icon: <IconUsers /> },
  grant: { tone: "purple", icon: <IconShieldCheck /> },
  auth: { tone: "purple", icon: <IconShieldCheck /> },
  profile: { tone: "purple", icon: <IconShieldCheck /> },
  person: { tone: "purple", icon: <IconShieldCheck /> },
  settlement: { tone: "blue", icon: <IconRupee /> },
  payment: { tone: "blue", icon: <IconRupee /> },
  finops: { tone: "purple", icon: <IconReceipt /> },
  ground: { tone: "amber", icon: <IconPin /> },
  venue: { tone: "amber", icon: <IconPin /> },
};

export function activityStyle(action: string): { tone: KitTone; icon: ReactNode } {
  return ACTIVITY_STYLE[action.split(".")[0] ?? ""] ?? { tone: "neutral", icon: <IconBolt /> };
}

export function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

/**
 * Consecutive events that say the same thing about the same place fold into
 * one row with a count: six "Registration poster generated · Thane Sports
 * Club" lines were ~360px of one fact. The newest of the run stands for it.
 */
export function groupActivity<T extends { action: string }>(
  rows: readonly T[],
  sameAs: (row: T) => string = (row) =>
    `${row.action}|${(row as { scope?: string | null }).scope ?? ""}`,
): { row: T; times: number }[] {
  const out: { row: T; times: number; key: string }[] = [];
  for (const row of rows) {
    const key = sameAs(row);
    const last = out[out.length - 1];
    if (last !== undefined && last.key === key && row.action !== "finops.summary") {
      last.times += 1;
    } else {
      out.push({ row, times: 1, key });
    }
  }
  return out;
}
