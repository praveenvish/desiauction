import { expect, it } from "vitest";
import { boundedInsightQuery, insightHref } from "./insight-navigation";
it("retains all five conditions when switching view and building an authentication return", () => {
  const query = {
    view: "batting",
    ballType: "tape",
    timeOfDay: "day_night",
    formatKey: "t10",
    pitch: "matting",
    groundType: "box",
  };
  const href = insightHref("/me/insights", query, { view: "bowling" });
  const selected = new URL(href, "https://example.test").searchParams;
  expect(Object.fromEntries(selected)).toEqual({ ...query, view: "bowling" });
  expect(new URLSearchParams({ next: href }).get("next")).toBe(href);
});
it("refuses repeated, oversized and unrelated selections without losing a bounded historical format", () => {
  expect(
    boundedInsightQuery({
      view: "invalid",
      ballType: ["leather", "tape"],
      pitch: "x".repeat(41),
      formatKey: "historical_format",
      next: "https://other.test",
      groundType: "indoor",
    }),
  ).toEqual({ formatKey: "historical_format", groundType: "indoor" });
});
it("clears a condition while preserving the current view and other selections", () => {
  expect(
    insightHref(
      "/me/insights",
      { view: "bowling", pitch: "turf", ballType: "rubber" },
      { pitch: "" },
    ),
  ).toBe("/me/insights?view=bowling&ballType=rubber");
  expect(insightHref("/me/insights", { view: ["batting", "bowling"] })).toBe("/me/insights");
});
