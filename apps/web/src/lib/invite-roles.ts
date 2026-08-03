/**
 * What a capability set is CALLED, and what it lets a person do — in words.
 *
 * `/join` used to render `preview.capabilitySet` straight into a badge, so the
 * sentence asking somebody to accept authority over a club read "You've been
 * invited to Demo Club as ORG:STAFF". A database enum is not consent. The
 * labels and the one-line meanings already existed in `members-panel.tsx`,
 * where only the person handing the authority OUT could read them; they live
 * here now so the person accepting it reads the same words.
 */

export const INVITE_ROLE_LABEL: Record<string, string> = {
  "org:staff": "Staff",
  viewer: "Member",
  "org:owner": "Owner",
};

export const INVITE_ROLE_HELP: Record<string, string> = {
  "org:staff": "Runs seasons, teams, registrations and fixtures — not the money or roles.",
  viewer: "Read-only access to this organization.",
  "org:owner": "Full control: roles, money, members and every season this club runs.",
};

/** The plain name, falling back to the raw set rather than inventing one. */
export function roleLabel(capabilitySet: string): string {
  return INVITE_ROLE_LABEL[capabilitySet] ?? capabilitySet;
}

/** The one-line authority statement, or null when we have nothing honest to say. */
export function roleHelp(capabilitySet: string): string | null {
  return INVITE_ROLE_HELP[capabilitySet] ?? null;
}
