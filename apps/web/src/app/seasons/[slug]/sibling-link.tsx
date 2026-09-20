import { ButtonLink, IconArrowRight } from "@desiauction/ui";

/**
 * THE WAY TO A TAB'S SIBLING (RN-1 Phase 4).
 *
 * The organizer's strip went from nine tabs to seven by joining surfaces that
 * answer one question: Players is Registrations AND Lineups, Schedule is
 * Fixtures AND the Table. The merged-away routes still exist and still matter,
 * so each pair links to the other from the PAGE — not from a second tab strip
 * under the first, which would be the third list LAW 1 exists to prevent.
 *
 * Page content, in `PageIntro`'s actions slot, where a page's own affordances
 * live. The strip meanwhile lights the PARENT for both (`claims` in nav.ts), so
 * a reader on Lineups still sees "Players" underlined and knows where they are.
 */
export function SiblingLink({ href, label }: { href: string; label: string }) {
  return (
    <ButtonLink href={href} variant="secondary" data-testid="season-sibling">
      {label}
      <IconArrowRight size={16} className="icon-trail" />
    </ButtonLink>
  );
}
