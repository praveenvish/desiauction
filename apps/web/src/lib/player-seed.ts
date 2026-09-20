/**
 * THE ONE SEED RULE for a player's branded mark (C-25).
 *
 * `PlayerImage` derives the monogram's pattern, angle and accent from its
 * seed, so the seed IS the player's face whenever there is no photo. It was
 * chosen surface by surface — the lot id on the block, the registration number
 * on the board, the person id on the desk — and the same player wore a
 * different mark on each. On every season surface the seed is the REGISTRATION
 * id; only a view with no registration (a person's own /me, /account) falls
 * back to the person id.
 *
 * The live snapshot names a lot by lot id alone, so lot-keyed views look the
 * registration up in `lotMedia` (which carries it) and fall back to the lot id
 * only for a lot added after the page's media was read.
 */
export function lotSeed(
  lotId: string,
  media: Readonly<Record<string, { registrationId: string }>> | undefined,
): string {
  return media?.[lotId]?.registrationId ?? lotId;
}
