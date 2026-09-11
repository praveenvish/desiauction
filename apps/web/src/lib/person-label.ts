import { formatPhone } from "./format-phone";

/**
 * WHAT TO CALL SOMEBODY WHO HAS NOT TOLD US THEIR NAME.
 *
 * Every screen that lists people fell back to the phone number — `name ??
 * phone` — because until 0062 every account had one. An email-anchored person
 * has none, and `name ?? phone` on them renders empty: a blank row in a
 * settlement register beside real money, which is worse than useless because
 * nobody can tell WHICH blank row is which.
 *
 * The order is what a person would recognise about themselves, most specific
 * first. The last resort is deliberately not "Unknown" — an account always has
 * at least one of the two (`people_reachable_check`), so falling through to a
 * literal means somebody passed a projection that forgot to select them, and
 * saying so is more useful than a label that reads like a real answer.
 */
export function personLabel(person: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}): string {
  const name = person.name?.trim();
  if (name !== undefined && name !== "") {
    return name;
  }
  return person.phone ?? person.email ?? "Unnamed account";
}

/**
 * THE CONTACT COLUMN, when the contact might not be a phone.
 *
 * Screens that show a person's contact all called `formatPhone(row.phone)`,
 * which since 0062 can be handed a null. Rendering an empty cell is the worst
 * outcome — a finance authority list with a blank contact is a row nobody can
 * chase — so this answers with whatever the account is actually anchored by.
 *
 * The phone wins when both exist because it is the number an organizer rings;
 * the email is the fallback the account chose, not a downgrade.
 */
export function personContact(person: { phone?: string | null; email?: string | null }): string {
  if (person.phone !== null && person.phone !== undefined) {
    return formatPhone(person.phone);
  }
  return person.email ?? "—";
}

/**
 * THE AVATAR, from whatever we can call them.
 *
 * Three screens carried a byte-identical copy of this keyed on `name ?? phone`,
 * so an email-anchored person would have produced "—" on all three. One copy,
 * over `personLabel`, so the avatar says the same thing the name beside it does.
 */
export function personInitials(person: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}): string {
  const parts = personLabel(person).trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return (
    parts
      .map((word) => {
        const cp = word.codePointAt(0);
        return cp === undefined ? "" : String.fromCodePoint(cp);
      })
      .join("")
      .toUpperCase() || "—"
  );
}
