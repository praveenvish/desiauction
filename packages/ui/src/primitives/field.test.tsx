import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, Select } from "./field";

describe("Field", () => {
  it("wires label, help and error to the input", () => {
    render(<Field label="Team name" help="Shown on the stage" error="Required" />);
    const input = screen.getByLabelText("Team name");
    expect(input).toHaveAccessibleDescription("Required Shown on the stage");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("is valid by default", () => {
    render(<Field label="Phone" />);
    expect(screen.getByLabelText("Phone")).not.toHaveAttribute("aria-invalid");
  });

  it("marks required accessibly", () => {
    render(<Field label="Name" required />);
    expect(screen.getByLabelText(/Name/)).toHaveAttribute("aria-required", "true");
  });
});

describe("Select", () => {
  it("is a labelled native select", () => {
    render(
      <Select label="Role">
        <option value="bat">Batter</option>
        <option value="bowl">Bowler</option>
      </Select>,
    );
    const select = screen.getByLabelText("Role");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Bowler" })).toBeInTheDocument();
  });
});
