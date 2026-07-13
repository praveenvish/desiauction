import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("opens as a modal with an accessible title", () => {
    render(
      <Dialog open onClose={() => undefined} title="Remove player?">
        <p>This cannot be undone.</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Remove player?");
    expect(screen.getByText("This cannot be undone.")).toBeVisible();
  });

  it("renders footer actions", () => {
    render(
      <Dialog
        open
        onClose={() => undefined}
        title="Confirm"
        footer={<Button variant="danger">Remove</Button>}
      >
        body
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  it("fires onClose when the native dialog closes (Escape path)", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new Event("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
