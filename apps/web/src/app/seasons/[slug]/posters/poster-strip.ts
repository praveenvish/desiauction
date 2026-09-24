import {
  Fragment,
  cloneElement,
  createElement,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * THE EFFECTS NOBODY SEES, REMOVED BEFORE THEY ARE PAID FOR.
 *
 * A motion band is the whole poster drawn with every OTHER band at
 * `opacity: 0` (see `vis` in poster-kit.tsx) — the invisible elements have to
 * stay, because they hold the layout the visible ones sit in. But resvg still
 * computes every blur on an invisible element: the price band paid for the
 * glass panel's 90px shadow, the name's 50px text shadow, the coins' and pills'
 * cast shadows, and multiplied each by zero. Blur is the dominant cost of a
 * poster render (a 1080×1920 canvas with nothing but one 90px shadow takes
 * ~0.5 s), so this was most of a band's time.
 *
 * This walks the element tree, expands our own function components the way
 * Satori would (they are pure — no hooks, no context), and drops `boxShadow`,
 * `textShadow` and `filter` from every node inside an `opacity: 0` subtree.
 * Nothing that affects layout is touched, and a shadow on a fully transparent
 * node contributes nothing to the composite, so the drawn pixels do not move.
 */
interface StyledProps {
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/**
 * The style, less the effects that cost a blur and show nothing here. The keys
 * are REMOVED, not set to "none": Satori still built a filter for a
 * `boxShadow: "none"` and the band cost ~16 s instead of ~6.
 */
const INVISIBLE_EFFECTS: ReadonlySet<string> = new Set(["boxShadow", "textShadow", "filter"]);

function stripped(style: CSSProperties): CSSProperties {
  return Object.fromEntries(Object.entries(style).filter(([key]) => !INVISIBLE_EFFECTS.has(key)));
}

function walk(node: ReactNode, hidden: boolean): ReactNode {
  if (Array.isArray(node)) {
    return node.map((child: ReactNode) => walk(child, hidden));
  }
  if (!isValidElement(node)) {
    return node;
  }
  const element = node as ReactElement<StyledProps>;
  if (typeof element.type === "function") {
    const component = element.type as (props: StyledProps) => ReactNode;
    return walk(component(element.props), hidden);
  }
  if ((element.type as unknown) === Fragment) {
    return createElement(Fragment, null, walk(element.props.children, hidden));
  }
  const style = element.props.style;
  const invisible = hidden || style?.opacity === 0;
  const children = walk(element.props.children, invisible);
  return invisible && style !== undefined
    ? cloneElement(element, { style: stripped(style) }, children)
    : cloneElement(element, undefined, children);
}

/** The band, with every effect inside an invisible subtree removed. */
export function withoutHiddenEffects(element: ReactElement): ReactElement {
  const out = walk(element, false);
  return isValidElement(out) ? out : createElement(Fragment, null, out);
}
