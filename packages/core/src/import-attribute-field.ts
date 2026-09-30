/**
 * A SPORT'S OWN PLAYER DETAIL, AS AN IMPORT FIELD.
 *
 * `IMPORT_FIELDS` is fixed, and it spoke only cricket: batting and bowling
 * style are columns there, and every other pack's attributes (football's
 * preferred foot, volleyball's spiking hand, table tennis's grip) had no field
 * to land in — a football club's "Preferred foot" column came back unmapped
 * and the answers were dropped, while the pack sat there declaring the very
 * `headerAliases` that would have recognised it.
 *
 * So a pack's JSON-stored attributes become fields of their own, prefixed so a
 * pack can never name one that shadows a fixed field. Cricket's two attributes
 * are COLUMN-stored and already are fixed fields (`batting_style`,
 * `bowling_style`), so they are not repeated here and cricket imports exactly
 * as it did.
 */
export const ATTRIBUTE_FIELD_PREFIX = "attr:";

export type AttributeImportField = `attr:${string}`;

export function attributeImportField(key: string): AttributeImportField {
  return `${ATTRIBUTE_FIELD_PREFIX}${key}`;
}

/** The attribute key behind an `attr:` field, else null. */
export function attributeKeyOf(field: string): string | null {
  return field.startsWith(ATTRIBUTE_FIELD_PREFIX)
    ? field.slice(ATTRIBUTE_FIELD_PREFIX.length)
    : null;
}
