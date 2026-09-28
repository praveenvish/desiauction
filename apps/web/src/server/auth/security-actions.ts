/**
 * The person-scoped ledger's vocabulary — its own module so the inbox's
 * labels (lib/inbox-events) and the writer (security-events) can both name it
 * without importing each other (email programme PR18).
 */
export type SecurityAction =
  | "auth.login.otp"
  /** Signed in with a code sent to a verified mailbox (email sign-in). */
  | "auth.login.email"
  /**
   * The account was CREATED by that code (Phase 2 email sign-up). Its own row
   * rather than a login: this is the first line of the person's ledger, and it
   * is the one that answers "where did this account come from?" — which a run
   * of identical `auth.login.email` rows never could.
   */
  | "auth.signup.email"
  | "auth.login.passkey"
  | "auth.otp.lockout"
  // PI-1 audit-gap closures. Requests, sign-outs and refused passkey
  // ceremonies were invisible: the ledger showed only what SUCCEEDED, so the
  // page a person checks after "did someone try to get in?" had no idea.
  // Each is written only when a person exists to own the row — the audit
  // substrate is person-scoped, and an unknown phone has no ledger.
  | "auth.otp.requested"
  | "auth.logout"
  | "auth.passkey.failed"
  | "auth.passkey.enrolled"
  | "auth.passkey.renamed"
  | "auth.passkey.removed"
  | "auth.session.revoked"
  // PX-3: profile changes are person-scoped evidence on the same ledger.
  | "profile.name.updated"
  // The FIRST name is not an update. Every new account's very first inbox row
  // read "Name updated" about a name that had never existed — the product's
  // opening sentence to a person, and it was wrong about the one thing that
  // had just happened. Same ledger, no new store; a different verb.
  | "profile.name.set"
  // The account's ONE credential moving. Written for the person, not for us:
  // sign-in is phone-first, so this row is the record of the single change that
  // can take an account away from somebody.
  | "auth.phone.changed"
  // An address the platform may now send documents to. On the person's own
  // ledger, because it is a change to how the product can reach them.
  | "profile.email.verified"
  // PI-1: the person-level cricket profile changed (gender/DOB/location/
  // defaults). Meta names the FIELDS touched, never the values — the ledger
  // records that an answer moved, not what a person answered.
  | "profile.player.updated"
  // DA-19: the decisions a PLAYER cares about. 48 people were approved and one
  // rejected during certification and not one of them was told — the inbox
  // carried sign-in events only, and its own empty state admitted it. These
  // ride the same person-scoped ledger; no notification store was invented.
  | "registration.approved"
  // Email programme PR4: the player's own registration, received — and the two
  // decisions that had an email and a text but no inbox row.
  | "registration.received"
  | "registration.withdrawn"
  | "registration.restored"
  // Email programme PR5: DesiAuction held (or released) a season's public page —
  // on each organizer's own ledger, so they never learn it from a blank page.
  | "season.held"
  | "season.released"
  // Email programme PR7: a team's owner accepted, and every team has one.
  | "auction.owner_joined"
  | "auction.owners_ready"
  // Email programme PR8: half an hour before auction night, in everyone's inbox.
  | "auction.starting_soon"
  | "registration.rejected"
  | "registration.waitlisted"
  // The night itself. Being sold at auction is the moment this whole product
  // exists for, and the player was the one person never told it had happened —
  // the same hole DA-19 closed for registration decisions, reopened at the
  // climax. Written at COMPLETION, not at the hammer: an unsold lot is requeued
  // by default, so "unsold" mid-night is a verdict the auction has not reached.
  | "auction.sold"
  | "auction.unsold"
  // The organizer named this person captain, vice-captain, icon or retained
  // player (meta: role, team, competition) — announced, not toggled: written
  // only when the organizer presses Announce (appointments.ts).
  | "team.appointed"
  | "team.squad_sheet"
  | "fixture.lineup_announced"
  // Email programme PR11: a published match moved or was called off.
  | "fixture.changed"
  // Email programme PR12: the organizer named the season's champion.
  | "season.champion"
  // Email programme PR13: someone used a club invite link (to its sender and owners).
  | "club.member_joined"
  // Email programme PR15: a season's pass request was granted or declined.
  | "plan.answered"
  // The person asked for their account to be erased, or took the request back.
  // On their own ledger because it is the one request that ends the account;
  // the DECISION is on the request itself, which /account reads.
  | "privacy.erasure.requested"
  | "privacy.erasure.withdrawn";
