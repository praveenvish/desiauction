import { fireEvent, render, screen } from "@testing-library/react";
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

  /**
   * A click on the dialog's own padding — or the gap beside a footer button —
   * also targets the <dialog> element, so targeting alone cannot tell a
   * backdrop click from a near-miss. Dismissing on a near-miss threw away a
   * half-filled Add-player form when the click landed a few pixels short.
   */
  it("closes on a click OUTSIDE its box, not on a near-miss inside it", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 400,
      top: 100,
      bottom: 400,
      x: 100,
      y: 100,
      width: 300,
      height: 300,
      toJSON: () => ({}),
    });

    fireEvent.click(dialog, { clientX: 250, clientY: 380 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).toHaveBeenCalledTimes(1);
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
