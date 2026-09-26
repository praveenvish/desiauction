import type { ReactNode, SVGProps } from "react";

/**
 * The one renderer behind every generated icon (./glyphs/*, written by
 * scripts/generate-icon-glyphs.mjs). A glyph carries only the weights the
 * product draws; asking for one it does not carry falls back to "regular",
 * so a new call site can never render an empty square.
 */
export type IconWeight = "regular" | "fill" | "duotone" | "bold";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref" | "color"> {
  /** Rendered width and height in px: 16, 20 (default) or 24. */
  size?: number;
  weight?: IconWeight;
  /** Accessible title, for the rare icon that stands alone. */
  alt?: string;
}

type Weights = { regular?: ReactNode } & Partial<Record<IconWeight, ReactNode>>;

export function glyph(name: string, weights: Weights, fixed?: IconWeight) {
  const fallback = weights.regular ?? weights[fixed ?? "fill"];
  function Icon({ size = 20, weight = "regular", alt, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden
        {...props}
      >
        {alt !== undefined ? <title>{alt}</title> : null}
        {weights[fixed ?? weight] ?? fallback}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}
