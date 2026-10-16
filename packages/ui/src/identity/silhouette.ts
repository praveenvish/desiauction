/**
 * THE CRICKETER — the one figure a season may choose for players with no photo.
 *
 * C-25 made the branded initials mark the only placeholder, and it stays the
 * default. A season can choose this instead (`competitions.no_photo_style`,
 * 0107): a club whose roster is mostly photo-less asked for one recognisable
 * figure rather than a wall of letters. It is a cricketer, not a grey person —
 * helmet, grille and bat — and it takes the team's colour like the mark does.
 *
 * Drawn in a 100×100 box, head-and-shoulders, so it still reads at 24px.
 * The same geometry draws in the browser (`PlayerImage`) and in every server
 * image (`silhouetteSvg`), so a player looks the same on a poster as on the
 * Players list.
 */
export type NoPhotoStyle = "initials" | "silhouette";

export const NO_PHOTO_STYLES: readonly NoPhotoStyle[] = ["initials", "silhouette"];

export function isNoPhotoStyle(value: unknown): value is NoPhotoStyle {
  return value === "initials" || value === "silhouette";
}

/** The figure: bat, grip, shoulders, neck, helmet, peak, face guard. */
export const SILHOUETTE_BODY: readonly string[] = [
  "M69 82 L83.5 35 Q84.5 31.5 88 32.5 L91 33.5 Q94 34.5 93 38 L78.5 85 Z",
  "M87.6 16.6 Q88.8 16 90 16.4 Q91.4 17 91 18.6 L87.1 33.3 Q86.6 34.6 85.3 34.3 Q84 33.8 84.4 32.4 Z",
  "M12 100 C12 85 22 75 37 72 L63 72 C78 75 88 85 88 100 Z",
  "M46 60 L54 60 Q57 60 57 63 L57 74 L43 74 L43 63 Q43 60 46 60 Z",
  "M30 50 C30 31 39 20 50 20 C61 20 70 31 70 50 L70 58 Q70 60 68 60 L66 60 L66 50 L34 50 L34 60 L32 60 Q30 60 30 58 Z",
  "M31 45.5 L69 45.5 Q73 46.5 74 49.5 L26 49.5 Q27 46.5 31 45.5 Z",
  "M35 51.5 L65 51.5 C65 61.5 58.5 68.5 50 68.5 C41.5 68.5 35 61.5 35 51.5 Z",
];

/** The grille bars, cut out of the face guard in the background colour. */
export const SILHOUETTE_GRILLE: readonly string[] = ["M36 56 H64", "M38.5 61 H61.5", "M50 52 V68"];

/**
 * The figure as a standalone SVG document, for a rasterizer that takes an
 * image source (Satori) or a `data:` URI. Colours are literal: no CSS
 * variables reach a server image.
 */
export function silhouetteSvg(colors: {
  /** The tile behind the figure; null leaves it transparent over the caller's own fill. */
  readonly field: string | null;
  /** The figure itself. */
  readonly figure: string;
  /** The grille bars, cut out of the face guard; defaults to the field. */
  readonly cutout?: string;
  /** Optional team colour, washed in from the upper left like the mark's. */
  readonly team?: string | null;
}): string {
  const team = colors.team ?? null;
  const wash =
    team === null
      ? ""
      : `<defs><radialGradient id="w" cx="28%" cy="18%" r="95%"><stop offset="0" stop-color="${team}" stop-opacity="0.6"/><stop offset="0.55" stop-color="${team}" stop-opacity="0.2"/><stop offset="1" stop-color="${team}" stop-opacity="0"/></radialGradient></defs><rect width="100" height="100" fill="url(#w)"/>`;
  const body = SILHOUETTE_BODY.map((d) => `<path d="${d}"/>`).join("");
  const grille = SILHOUETTE_GRILLE.map((d) => `<path d="${d}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
    (colors.field === null ? "" : `<rect width="100" height="100" fill="${colors.field}"/>`) +
    wash +
    `<g fill="${colors.figure}">${body}</g>` +
    `<g stroke="${colors.cutout ?? colors.field ?? "none"}" stroke-width="2" stroke-linecap="round" fill="none">${grille}</g>` +
    `</svg>`
  );
}

/** `silhouetteSvg` as a `data:` URI, ready for an `<img src>`. */
export function silhouetteDataUri(colors: Parameters<typeof silhouetteSvg>[0]): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(silhouetteSvg(colors))}`;
}
