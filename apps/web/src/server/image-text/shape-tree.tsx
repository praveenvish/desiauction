import {
  Fragment,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { SHAPED_FAMILY, SHAPED_FIRST, SHAPED_LIMIT, buildShapedFont } from "./shaped-font";
import {
  DEVANAGARI_RUN,
  devanagariShaper,
  hasDevanagari,
  type ShapedCluster,
  type Shaper,
} from "./shaper";

/**
 * EVERY STRING IN AN IMAGE, CHECKED FOR DEVANAGARI ON THE WAY TO SATORI.
 *
 * The image tree is walked the way Satori itself walks it — function
 * components are called, fragments flattened — and each text child holding
 * Devanagari is rewritten into the shaped clusters' characters
 * (`shaped-font.ts`). The element that holds the text gets the shaped family
 * at the END of its font list, so its line keeps the metrics of the type it
 * already had and only the characters no other face maps fall through to it.
 *
 * Done here, at the one door every image goes through, rather than at each
 * name: a poster added next year cannot forget it.
 */
export interface ShapedTree {
  readonly node: ReactNode;
  /** The image's own font, or null when the tree held no Devanagari. */
  readonly font: ArrayBuffer | null;
}

export async function shapeTree(node: ReactNode, rootFamily: string | null): Promise<ShapedTree> {
  if (!treeHasDevanagari(node)) {
    return { node, font: null };
  }
  const shaper = await devanagariShaper();
  const clusters = new Map<string, { index: number; cluster: ShapedCluster }>();
  const walker = new Walker(shaper, clusters);
  const shaped = walker.walk(node, rootFamily);
  const ordered = [...clusters.values()]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.cluster);
  return { node: shaped, font: buildShapedFont(shaper, ordered) };
}

/** Cheap pre-check, so a Latin-only image costs one walk and no wasm. */
function treeHasDevanagari(node: ReactNode): boolean {
  if (typeof node === "string") {
    return hasDevanagari(node);
  }
  if (Array.isArray(node)) {
    return node.some((child) => treeHasDevanagari(child as ReactNode));
  }
  if (!isValidElement(node)) {
    return false;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function") {
    return treeHasDevanagari(render(element));
  }
  return treeHasDevanagari(element.props.children);
}

/** A function component, rendered the way Satori renders it: called with its props. */
function render(element: ReactElement): ReactNode {
  return (element.type as (props: unknown) => ReactNode)(element.props);
}

class Walker {
  constructor(
    private readonly shaper: Shaper,
    private readonly clusters: Map<string, { index: number; cluster: ShapedCluster }>,
  ) {}

  walk(node: ReactNode, family: string | null): ReactNode {
    if (typeof node === "string") {
      // A bare string at the root: give it an element to carry the family.
      return hasDevanagari(node) ? (
        <div style={{ display: "flex", fontFamily: withShaped(family) }}>{this.text(node)}</div>
      ) : (
        node
      );
    }
    if (Array.isArray(node)) {
      return node.map((child) => this.walk(child as ReactNode, family));
    }
    if (!isValidElement(node)) {
      return node;
    }
    const element = node as ReactElement<{ children?: ReactNode; style?: CSSProperties }>;
    if (typeof element.type === "function") {
      return this.walk(render(element), family);
    }
    if (element.type === "svg" || element.type === "img") {
      // An <svg>'s text is drawn by the SVG rasterizer, not by Satori's text
      // engine; an <img> has no children.
      return element;
    }
    const style = element.props.style;
    const own = typeof style?.fontFamily === "string" ? style.fontFamily : family;
    const { children } = element.props;
    const seen = { devanagari: false };
    const next = mapChildren(children, (child) => {
      if (typeof child === "string" && hasDevanagari(child)) {
        seen.devanagari = true;
        return this.text(child);
      }
      return this.walk(child, own);
    });
    if ((element.type as unknown) === Fragment) {
      // A fragment carries no style; its strings are its parent's to restyle.
      return seen.devanagari ? (
        <div style={{ display: "flex", fontFamily: withShaped(own) }}>{next}</div>
      ) : (
        cloneElement(element, undefined, next)
      );
    }
    return cloneElement(
      element,
      seen.devanagari
        ? { style: { ...style, fontFamily: withShaped(own), ...untracked(style) } }
        : undefined,
      next,
    );
  }

  /** Each Devanagari run becomes its clusters' Private Use Area characters. */
  private text(value: string): string {
    return value.replace(DEVANAGARI_RUN, (run) =>
      hasDevanagari(run)
        ? this.shaper
            .shape(run)
            .map((cluster) => String.fromCharCode(SHAPED_FIRST + this.indexOf(cluster)))
            .join("")
        : run,
    );
  }

  private indexOf(cluster: ShapedCluster): number {
    const known = this.clusters.get(cluster.key);
    if (known !== undefined) {
      return known.index;
    }
    const index = this.clusters.size;
    if (index >= SHAPED_LIMIT) {
      throw new Error("Too many distinct Devanagari clusters for one image");
    }
    this.clusters.set(cluster.key, { index, cluster });
    return index;
  }
}

/** Children mapped without React's key machinery — Satori reads them as given. */
function mapChildren(children: ReactNode, map: (child: ReactNode) => ReactNode): ReactNode {
  if (Array.isArray(children)) {
    return children.map((child) => mapChildren(child as ReactNode, map));
  }
  return map(children);
}

/**
 * Hindi is never letter-spaced. Tracking suits Latin capitals; between
 * Devanagari letters it breaks the headline that joins them, and a kicker
 * like "बिश्नोई प्रीमियर लीग" came out as separate letters. Tightening (a
 * negative value) is left alone.
 */
function untracked(style: CSSProperties | undefined): CSSProperties {
  const spacing = style?.letterSpacing;
  return (typeof spacing === "number" && spacing > 0) ||
    (typeof spacing === "string" && !spacing.trim().startsWith("-") && parseFloat(spacing) > 0)
    ? { letterSpacing: 0 }
    : {};
}

function withShaped(family: string | null): string {
  return family === null || family.trim() === ""
    ? `"${SHAPED_FAMILY}"`
    : `${family}, "${SHAPED_FAMILY}"`;
}
