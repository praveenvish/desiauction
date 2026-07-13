import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { Money } from "./money";
import { Skeleton } from "./skeleton";

describe("Badge", () => {
  it("renders its label", () => {
    render(<Badge tone="success">Paid</Badge>);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });
});

describe("Card", () => {
  it("renders children and forwards attributes", () => {
    render(<Card data-testid="card">Inside</Card>);
    expect(screen.getByTestId("card")).toHaveTextContent("Inside");
  });
});

describe("Money", () => {
  it("exposes the exact value to assistive tech and hover (C-7)", () => {
    render(<Money exact="₹1,10,50,000.00">₹1.1 Cr</Money>);
    const money = screen.getByText("₹1.1 Cr");
    expect(money).toHaveAttribute("title", "₹1,10,50,000.00");
    expect(money).toHaveAttribute("aria-label", "₹1,10,50,000.00");
  });

  it("renders plain when no exact value is provided", () => {
    render(<Money>₹80,000</Money>);
    expect(screen.getByText("₹80,000")).not.toHaveAttribute("title");
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech", () => {
    render(<Skeleton data-testid="sk" />);
    expect(screen.getByTestId("sk")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    render(
      <EmptyState
        title="No players yet"
        description="Share the registration link to fill the pool."
        action={<a href="/invite">Share link</a>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No players yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Share link" })).toBeInTheDocument();
  });
});
