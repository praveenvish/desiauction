/**
 * Shell icons now come from the one icon set (`../icons/icons`). This module
 * stays so existing imports keep working; the brand glyph lives here because
 * it is a mark, not an icon — filled, its own viewBox, its own colours.
 */
export {
  IconHome,
  IconTrophy,
  IconUsers,
  IconRupee,
  IconHelp,
  IconSearch,
  IconBell,
  IconMenu,
  IconClose,
  IconChevronDown,
  IconArrowLeft,
  IconAlert,
  IconCalendar,
  IconMatch,
  IconPin,
  IconArrowRight,
  IconList,
  IconGrid,
  IconKebab,
  IconExternal,
} from "../icons/icons";

/**
 * The brand glyph: rising bids-as-stumps and the gavel mid-strike, with a gold
 * spark. Decorative — always wrap it in an aria-hidden chip. Filled (not the
 * outline set), so it renders standalone with its own viewBox and colors
 * (bars inherit `currentColor`; the spark is fixed ceremony gold).
 */
export function BrandGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="currentColor" aria-hidden>
      <rect x="7" y="39" width="9" height="18" rx="4.5" />
      <rect x="19.5" y="30" width="9" height="27" rx="4.5" />
      <rect x="32" y="21" width="9" height="36" rx="4.5" />
      <g transform="translate(47 14) rotate(-45)">
        <rect x="3.5" y="-1.9" width="13" height="3.8" rx="1.9" />
        <rect x="-4.5" y="-9" width="9" height="18" rx="4.5" />
      </g>
      <path
        style={{ fill: "var(--ceremony-gold, #F0B429)" }}
        d="M40 13.4 L41.1 15.9 L43.6 17 L41.1 18.1 L40 20.6 L38.9 18.1 L36.4 17 L38.9 15.9 Z"
      />
    </svg>
  );
}
