import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card, cardClassName } from "./card";
import styles from "./card.module.css";

describe("Card", () => {
  it("rests raised with default padding, and never interactive by default", () => {
    render(<Card data-testid="card">body</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveClass(styles["card"] ?? "", styles["default"] ?? "", styles["raised"] ?? "");
    expect(card).not.toHaveClass(styles["interactive"] ?? "");
  });

  it("interactive cards carry the shared hover language, flat cards no shadow", () => {
    render(
      <Card data-testid="card" interactive elevation="flat" padding="dense">
        body
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveClass(
      styles["interactive"] ?? "",
      styles["flat"] ?? "",
      styles["dense"] ?? "",
    );
  });

  it("cardClassName lets an anchor be a card without nesting one", () => {
    const classes = cardClassName({ interactive: true }, "extra");
    expect(classes.split(" ")).toEqual(
      expect.arrayContaining([styles["card"], styles["interactive"], "extra"]),
    );
  });
});
