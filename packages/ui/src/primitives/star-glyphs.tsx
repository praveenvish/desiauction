import { IconStar, IconStarOutline } from "../icons/icons";

import styles from "./star-glyphs.module.css";

/**
 * A rating drawn as icons, never as typed "★" characters (a font glyph changes
 * weight and baseline from one screen to the next). Decorative: the caller
 * carries the "4 out of 5" text for screen readers. Filled stars take the
 * parent's colour; the rest take `--border-strong`.
 */
export function StarGlyphs({ rating, size = 16 }: { rating: number; size?: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className={styles["row"]} aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) =>
        index < filled ? (
          <IconStar key={index} size={size} />
        ) : (
          <IconStarOutline key={index} size={size} className={styles["rest"]} />
        ),
      )}
    </span>
  );
}
