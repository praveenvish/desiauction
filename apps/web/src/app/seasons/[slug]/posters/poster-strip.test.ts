import { createElement, Fragment, type CSSProperties, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { withoutHiddenEffects } from "./poster-strip";

type Styled = ReactElement<{ style?: CSSProperties; children?: unknown }>;

const SHADOWED: CSSProperties = {
  display: "flex",
  width: 100,
  boxShadow: "0 40px 90px rgba(0,0,0,0.8)",
  textShadow: "0 18px 50px rgba(0,0,0,0.5)",
  filter: "blur(4px)",
};

function child(element: Styled): Styled {
  return element.props.children as Styled;
}

describe("withoutHiddenEffects — a band pays only for the effects it shows", () => {
  it("drops shadows and filters inside an invisible subtree, and keeps its layout", () => {
    const band = createElement(
      "div",
      { style: { display: "flex", opacity: 0, width: 300 } },
      createElement("div", { style: SHADOWED }, "₹12,500"),
    ) as Styled;
    const out = withoutHiddenEffects(band) as Styled;
    expect(out.props.style).toEqual({ display: "flex", opacity: 0, width: 300 });
    expect(child(out).props.style).toEqual({ display: "flex", width: 100 });
    expect(child(out).props.children).toBe("₹12,500");
  });

  it("leaves every effect on a visible element alone", () => {
    const band = createElement(
      "div",
      { style: { display: "flex" } },
      createElement("div", { style: SHADOWED }),
    ) as Styled;
    expect(child(withoutHiddenEffects(band) as Styled).props.style).toEqual(SHADOWED);
  });

  /*
   * The effects are REMOVED, not set to "none": Satori rejects
   * `backgroundImage: "none"` outright and still builds a filter for a "none"
   * shadow, which cost a band ~10 s.
   */
  it('removes the keys rather than writing "none" into them', () => {
    const band = createElement("div", { style: { ...SHADOWED, opacity: 0 } }) as Styled;
    const style = (withoutHiddenEffects(band) as Styled).props.style ?? {};
    expect(Object.keys(style)).not.toContain("boxShadow");
    expect(Object.values(style)).not.toContain("none");
  });

  it("expands our own components the way Satori would, so their shadows are reached", () => {
    function Pill({ label }: { label: string }) {
      return createElement("div", { style: { ...SHADOWED, opacity: 0 } }, label);
    }
    const band = createElement(
      "div",
      { style: { display: "flex" } },
      createElement(Pill, { label: "SOLD" }),
    ) as Styled;
    const pill = child(withoutHiddenEffects(band) as Styled);
    expect(pill.type).toBe("div");
    expect(pill.props.style?.boxShadow).toBeUndefined();
    expect(pill.props.children).toBe("SOLD");
  });

  it("walks arrays and fragments", () => {
    const band = createElement(
      "div",
      { style: { display: "flex", opacity: 0 } },
      createElement(Fragment, null, [
        createElement("div", { key: "a", style: SHADOWED }),
        createElement("div", { key: "b", style: SHADOWED }),
      ]),
    ) as Styled;
    const fragment = child(withoutHiddenEffects(band) as Styled) as ReactElement<{
      children: Styled[];
    }>;
    for (const node of fragment.props.children) {
      expect(node.props.style?.textShadow).toBeUndefined();
    }
  });
});
